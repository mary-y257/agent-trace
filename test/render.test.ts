import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStats, renderTimeline } from '../src/render.ts';
import { computeStats } from '../src/stats.ts';
import type { TraceEvent } from '../src/types.ts';

test('renderStats on an empty trace has no tool table and n/a wall clock', () => {
  const text = renderStats(computeStats([]));
  const lines = text.split('\n');
  assert.match(lines[0], /^events\s+0\s+\(user 0, assistant 0, tool_call 0, tool_result 0\)$/);
  assert.match(lines[1], /^wall clock\s+n\/a$/);
  assert.equal(text.includes('share'), false);
});

test('renderStats includes a tool time percentage and a sorted tool table', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'a', name: 'cheap', args: null },
    { type: 'tool_result', ts: 10, id: 'a', ok: true, durationMs: 10, output: '', error: null },
    { type: 'tool_call', ts: 10, id: 'b', name: 'expensive', args: null },
    { type: 'tool_result', ts: 1010, id: 'b', ok: false, durationMs: 1000, output: '', error: 'boom' },
  ];
  const text = renderStats(computeStats(events));
  const lines = text.split('\n');

  assert.match(lines[2], /^tool time\s+1\.010s\s+\(100\.0% of wall clock\)$/);

  const header = lines.find((line) => line.startsWith('tool') && line.includes('share'));
  assert.ok(header);
  const expensiveRow = lines.find((line) => line.startsWith('expensive'));
  const cheapRow = lines.find((line) => line.startsWith('cheap'));
  assert.ok(expensiveRow && cheapRow);
  // expensive cost more time, so it must sort first.
  assert.ok(lines.indexOf(expensiveRow) < lines.indexOf(cheapRow));
  assert.match(expensiveRow, /1\s+1\s+1\.000s/);
});

test('renderStats omits the wall-clock percentage when the trace has zero duration', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 5, id: 'a', name: 'x', args: null },
    { type: 'tool_result', ts: 5, id: 'a', ok: true, durationMs: 20, output: '', error: null },
  ];
  const text = renderStats(computeStats(events));
  const toolTimeLine = text.split('\n').find((line) => line.startsWith('tool time'));
  assert.equal(toolTimeLine, 'tool time     20ms');
});

test('renderTimeline is empty for an empty trace', () => {
  assert.equal(renderTimeline([]), '');
});

test('renderTimeline orders user, assistant, tool_call and orphan lines with offsets', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 1000, text: 'do it' },
    { type: 'assistant', ts: 1100, text: 'ok', usage: { input: 100, output: 10 } },
    { type: 'tool_call', ts: 1200, id: 'c1', name: 'read_file', args: { path: 'a' } },
    { type: 'tool_result', ts: 1250, id: 'c1', ok: true, durationMs: 50, output: '', error: null },
    { type: 'tool_call', ts: 1300, id: 'c2', name: 'run_tests', args: null },
    { type: 'tool_result', ts: 1400, id: 'zzz', ok: true, durationMs: null, output: '', error: null },
  ];
  const lines = renderTimeline(events).split('\n');

  assert.equal(lines.length, 5);
  assert.ok(lines[0].includes('+0.000s') && lines[0].includes('user') && lines[0].includes('do it'));
  assert.ok(lines[1].includes('assistant') && lines[1].includes('[100 in / 10 out]'));
  assert.ok(lines[2].includes('read_file({"path":"a"})') && lines[2].includes('-> ok in 50ms'));
  assert.ok(lines[3].includes('run_tests') && lines[3].includes('-> pending'));
  assert.ok(lines[4].includes('(orphan id=zzz)') && lines[4].includes('-> ok') && !lines[4].includes(' in '));
});

test('renderTimeline reports a failed call with its error message', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'c1', name: 'run_tests', args: null },
    { type: 'tool_result', ts: 10, id: 'c1', ok: false, durationMs: 10, output: '', error: '3 tests failed' },
  ];
  const line = renderTimeline(events);
  assert.ok(line.includes('-> failed in 10ms: 3 tests failed'));
});

test('renderTimeline --tool filter hides text lines, other tools and orphans', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 0, text: 'hi' },
    { type: 'tool_call', ts: 1, id: 'a', name: 'read_file', args: null },
    { type: 'tool_result', ts: 2, id: 'a', ok: true, durationMs: 1, output: '', error: null },
    { type: 'tool_call', ts: 3, id: 'b', name: 'run_tests', args: null },
    { type: 'tool_result', ts: 4, id: 'b', ok: true, durationMs: 1, output: '', error: null },
    { type: 'tool_result', ts: 5, id: 'unmatched', ok: true, durationMs: null, output: '', error: null },
  ];
  const lines = renderTimeline(events, { tool: 'run_tests' }).split('\n');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('run_tests'));
});

test('renderTimeline --no-text hides user and assistant lines but keeps tool activity', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 0, text: 'hi' },
    { type: 'assistant', ts: 1, text: 'hello', usage: null },
    { type: 'tool_call', ts: 2, id: 'a', name: 'read_file', args: null },
    { type: 'tool_result', ts: 3, id: 'a', ok: true, durationMs: 1, output: '', error: null },
  ];
  const lines = renderTimeline(events, { showText: false }).split('\n');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('read_file'));
});

test('renderTimeline truncates long args to maxArgLength', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'a', name: 'write_file', args: { path: 'a', text: 'x'.repeat(50) } },
  ];
  const line = renderTimeline(events, { maxArgLength: 20 });
  const argsText = line.slice(line.indexOf('('), line.indexOf(')') + 1);
  assert.ok(argsText.includes('…'));
  assert.ok(!argsText.includes('x'.repeat(50)));
});
