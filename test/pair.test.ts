import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairToolEvents, spansByTool } from '../src/pair.ts';
import type { ToolCallEvent, ToolResultEvent, TraceEvent } from '../src/types.ts';

function call(id: string | null, name: string, ts: number | null = null): ToolCallEvent {
  return { type: 'tool_call', ts, id, name, args: null };
}

function result(id: string | null, overrides: Partial<ToolResultEvent> = {}): ToolResultEvent {
  return { type: 'tool_result', ts: null, id, ok: true, durationMs: null, output: '', error: null, ...overrides };
}

test('matches a call to its result by id', () => {
  const events: TraceEvent[] = [call('a', 'read_file'), result('a', { durationMs: 10, ok: true })];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 1);
  assert.equal(orphans.length, 0);
  assert.equal(spans[0].result, events[1]);
  assert.equal(spans[0].durationMs, 10);
  assert.equal(spans[0].ok, true);
});

test('falls back to FIFO order when neither side has an id', () => {
  const calls = [call(null, 'a'), call(null, 'b')];
  const results = [result(null, { output: 'first' }), result(null, { output: 'second' })];
  const events: TraceEvent[] = [calls[0], calls[1], results[0], results[1]];
  const { spans } = pairToolEvents(events);
  assert.equal(spans[0].result, results[0]);
  assert.equal(spans[1].result, results[1]);
});

test('a result whose id matches nothing becomes an orphan', () => {
  const events: TraceEvent[] = [call('a', 'read_file'), result('does-not-exist')];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans[0].result, null);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].event, events[1]);
  assert.equal(orphans[0].index, 1);
});

test('a duplicate call id only claims the first call', () => {
  const first = call('dup', 'a');
  const second = call('dup', 'b');
  const events: TraceEvent[] = [first, second, result('dup')];
  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans[0].call, first);
  assert.notEqual(spans[0].result, null);
  assert.equal(spans[1].call, second);
  assert.equal(spans[1].result, null);
  assert.equal(orphans.length, 0);
});

test('negative timestamp deltas are dropped rather than reported as a duration', () => {
  const events: TraceEvent[] = [call('a', 'x', 100), result('a', { ts: 50 })];
  const { spans } = pairToolEvents(events);
  assert.equal(spans[0].durationMs, null);
});

test('a self-reported duration wins over the timestamp delta', () => {
  const events: TraceEvent[] = [call('a', 'x', 100), result('a', { ts: 500, durationMs: 12 })];
  const { spans } = pairToolEvents(events);
  assert.equal(spans[0].durationMs, 12);
});

test('spansByTool groups by tool name, preserving call order', () => {
  const events: TraceEvent[] = [
    call('a', 'read_file'),
    call('b', 'run_tests'),
    call('c', 'read_file'),
    result('a'),
    result('b'),
    result('c'),
  ];
  const { spans } = pairToolEvents(events);
  const grouped = spansByTool(spans);
  assert.deepEqual([...grouped.keys()], ['read_file', 'run_tests']);
  assert.equal(grouped.get('read_file')?.length, 2);
  assert.equal(grouped.get('read_file')?.[0].call.id, 'a');
  assert.equal(grouped.get('read_file')?.[1].call.id, 'c');
});
