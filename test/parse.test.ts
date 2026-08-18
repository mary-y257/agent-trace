import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatIssue, parseTrace, parseTraceLine, parseTraceStrict } from '../src/parse.ts';
import type { LineResult } from '../src/parse.ts';
import type { TraceEvent, TraceIssue } from '../src/types.ts';

function expectEvent(result: LineResult): TraceEvent {
  if (!result.ok) throw new Error(`expected an event but got issue: ${result.issue.message}`);
  return result.event;
}

function expectIssue(result: LineResult): TraceIssue {
  if (result.ok) throw new Error('expected a parse issue but got an event');
  return result.issue;
}

test('parses the canonical field names for each event type', () => {
  const lines = [
    '{"type":"user","ts":1000,"text":"hi"}',
    '{"type":"assistant","ts":1100,"text":"hey","usage":{"input_tokens":10,"output_tokens":2}}',
    '{"type":"tool_call","ts":1200,"id":"c1","name":"read_file","args":{"path":"a.ts"}}',
    '{"type":"tool_result","ts":1250,"id":"c1","ok":true,"durationMs":50,"output":"done"}',
  ];
  const { events, issues } = parseTrace(lines.join('\n'));
  assert.equal(issues.length, 0);
  assert.deepEqual(events, [
    { type: 'user', ts: 1000, text: 'hi' },
    { type: 'assistant', ts: 1100, text: 'hey', usage: { input: 10, output: 2 } },
    { type: 'tool_call', ts: 1200, id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
    { type: 'tool_result', ts: 1250, id: 'c1', ok: true, durationMs: 50, output: 'done', error: null },
  ]);
});

test('accepts the field spellings other runtimes use', () => {
  const user = expectEvent(parseTraceLine('{"role":"human","message":"hi there"}'));
  assert.deepEqual(user, { type: 'user', ts: null, text: 'hi there' });

  const call = expectEvent(parseTraceLine('{"kind":"tool_use","tool_name":"grep","input":{"q":"x"}}'));
  assert.deepEqual(call, { type: 'tool_call', ts: null, id: null, name: 'grep', args: { q: 'x' } });

  const result = expectEvent(parseTraceLine('{"event":"tool_output","call_id":"c9","result":"ok"}'));
  assert.deepEqual(result, {
    type: 'tool_result',
    ts: null,
    id: 'c9',
    ok: true,
    durationMs: null,
    output: 'ok',
    error: null,
  });
});

test('reports unusable lines without losing usable ones, keeping correct line numbers', () => {
  const text = [
    '{"type":"user","text":"hi"}',
    '',
    'not-json',
    '{"type":"assistant","text":"yo"}',
  ].join('\n');
  const { events, issues } = parseTrace(text);
  assert.equal(events.length, 2);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 3);
  assert.match(issues[0].message, /^not valid json/);
});

test('flags missing and unknown event types', () => {
  assert.equal(expectIssue(parseTraceLine('{"foo":1}')).message, 'missing "type" (or "role") field');
  assert.equal(expectIssue(parseTraceLine('{"type":"weird"}')).message, 'unknown event type "weird"');
});

test('rejects json that does not decode to an object', () => {
  assert.equal(expectIssue(parseTraceLine('[1,2,3]')).message, 'expected a json object, got an array');
  assert.equal(expectIssue(parseTraceLine('"hello"')).message, 'expected a json object, got a string');
  assert.equal(expectIssue(parseTraceLine('42')).message, 'expected a json object, got a number');
  assert.equal(expectIssue(parseTraceLine('null')).message, 'expected a json object, got null');
});

test('a tool_call without a usable name is an issue', () => {
  assert.equal(expectIssue(parseTraceLine('{"type":"tool_call"}')).message, 'tool_call is missing a tool name');
  assert.equal(
    expectIssue(parseTraceLine('{"type":"tool_call","name":"   "}')).message,
    'tool_call is missing a tool name',
  );
});

test('normalises timestamps from seconds, milliseconds, ISO strings and offsets', () => {
  assert.equal(expectEvent(parseTraceLine('{"type":"user","ts":1700000000,"text":"x"}')).ts, 1700000000000);
  assert.equal(expectEvent(parseTraceLine('{"type":"user","ts":1700000000000,"text":"x"}')).ts, 1700000000000);
  assert.equal(
    expectEvent(parseTraceLine('{"type":"user","timestamp":"2024-01-01T00:00:00.000Z","text":"x"}')).ts,
    Date.parse('2024-01-01T00:00:00.000Z'),
  );
  assert.equal(expectEvent(parseTraceLine('{"type":"user","ts":"not-a-date","text":"x"}')).ts, null);
  assert.equal(expectEvent(parseTraceLine('{"type":"user","ts":500,"text":"x"}')).ts, 500);
  assert.equal(expectEvent(parseTraceLine('{"type":"user","text":"x"}')).ts, null);
});

test('reads token usage under any of the accepted key spellings', () => {
  const a = expectEvent(parseTraceLine('{"type":"assistant","usage":{"prompt_tokens":10,"completion_tokens":5}}'));
  assert.deepEqual((a as { usage: unknown }).usage, { input: 10, output: 5 });

  const b = expectEvent(parseTraceLine('{"type":"assistant","tokens":{"input":1,"output":2}}'));
  assert.deepEqual((b as { usage: unknown }).usage, { input: 1, output: 2 });

  const c = expectEvent(parseTraceLine('{"type":"assistant","usage":{"input_tokens":5}}'));
  assert.deepEqual((c as { usage: unknown }).usage, { input: 5, output: 0 });

  const d = expectEvent(parseTraceLine('{"type":"assistant","usage":{"foo":1}}'));
  assert.equal((d as { usage: unknown }).usage, null);

  const e = expectEvent(parseTraceLine('{"type":"assistant","text":"hi"}'));
  assert.equal((e as { usage: unknown }).usage, null);
});

test('infers tool_result.ok from explicit flags, status text, is_error and error presence', () => {
  const explicit = expectEvent(parseTraceLine('{"type":"tool_result","id":"x","ok":false,"error":null}'));
  assert.equal((explicit as { ok: unknown }).ok, false);

  const status = expectEvent(parseTraceLine('{"type":"tool_result","id":"x","status":"failed"}'));
  assert.equal((status as { ok: unknown }).ok, false);
  assert.equal((status as { error: unknown }).error, null);

  const isError = expectEvent(parseTraceLine('{"type":"tool_result","id":"x","is_error":true}'));
  assert.equal((isError as { ok: unknown }).ok, false);

  const fromError = expectEvent(parseTraceLine('{"type":"tool_result","id":"x","error":"boom"}'));
  assert.equal((fromError as { ok: unknown }).ok, false);
  assert.equal((fromError as { error: unknown }).error, 'boom');

  const bare = expectEvent(parseTraceLine('{"type":"tool_result","id":"x"}'));
  assert.equal((bare as { ok: unknown }).ok, true);
});

test('flattens array-shaped text into a single string', () => {
  const event = expectEvent(parseTraceLine('{"type":"user","text":[{"text":"hello"},"world",{"foo":1}]}'));
  assert.equal((event as { text: unknown }).text, 'hello\nworld\n{"foo":1}');
});

test('truncates the raw line kept on an issue to 100 characters', () => {
  const long = 'x'.repeat(150);
  const issue = expectIssue(parseTraceLine(long));
  assert.equal(issue.raw, `${'x'.repeat(100)}...`);

  const short = expectIssue(parseTraceLine('  {"bad}  '));
  assert.equal(short.raw, '{"bad}');
});

test('parseTraceStrict returns events when clean and throws when not', () => {
  const clean = '{"type":"user","text":"hi"}\n{"type":"assistant","text":"yo"}';
  assert.deepEqual(parseTraceStrict(clean), parseTrace(clean).events);

  const dirty = '{"type":"user","text":"hi"}\nnope';
  assert.throws(() => parseTraceStrict(dirty), /invalid trace: 1 unusable line/);
});

test('formatIssue renders line, message and raw text', () => {
  const issue: TraceIssue = { line: 3, message: 'not valid json (oops)', raw: 'not-json' };
  assert.equal(formatIssue(issue), 'line 3: not valid json (oops) -- not-json');
});
