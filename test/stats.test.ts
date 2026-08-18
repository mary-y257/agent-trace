import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../src/stats.ts';
import type { TraceEvent } from '../src/types.ts';

test('computeStats on an empty trace', () => {
  const stats = computeStats([]);
  assert.equal(stats.events, 0);
  assert.equal(stats.firstTs, null);
  assert.equal(stats.lastTs, null);
  assert.equal(stats.wallClockMs, null);
  assert.equal(stats.toolTimeMs, 0);
  assert.deepEqual(stats.tools, []);
  assert.equal(stats.failureRate, 0);
  assert.deepEqual(stats.tokens, { input: 0, output: 0, total: 0 });
});

test('computeStats aggregates timing, tokens, tools and failures', () => {
  const events: TraceEvent[] = [
    { type: 'user', ts: 1000, text: 'do it' },
    { type: 'assistant', ts: 1100, text: 'ok', usage: { input: 100, output: 10 } },
    { type: 'assistant', ts: 1200, text: 'working', usage: null },
    { type: 'tool_call', ts: 1300, id: 'c1', name: 'read_file', args: null },
    { type: 'tool_result', ts: 1350, id: 'c1', ok: true, durationMs: 50, output: 'ok', error: null },
    { type: 'tool_call', ts: 1400, id: 'c2', name: 'run_tests', args: null },
    { type: 'tool_result', ts: 1650, id: 'c2', ok: false, durationMs: null, output: '', error: 'boom' },
    { type: 'tool_call', ts: 1700, id: 'c3', name: 'run_tests', args: null },
    { type: 'tool_result', ts: 1800, id: 'c3', ok: true, durationMs: 100, output: 'ok', error: null },
    { type: 'tool_call', ts: 1900, id: 'c4', name: 'read_file', args: null },
    { type: 'tool_result', ts: 2000, id: 'zzz', ok: true, durationMs: 5, output: '', error: null },
  ];

  const stats = computeStats(events);

  assert.equal(stats.events, 11);
  assert.deepEqual(stats.byType, { user: 1, assistant: 2, tool_call: 4, tool_result: 4 });
  assert.equal(stats.firstTs, 1000);
  assert.equal(stats.lastTs, 2000);
  assert.equal(stats.wallClockMs, 1000);
  assert.deepEqual(stats.tokens, { input: 100, output: 10, total: 110 });

  // c2's result carries no self-reported duration, so its 250ms comes from the
  // ts delta (1650 - 1400); c4 never got a result, so it contributes nothing.
  assert.equal(stats.toolCalls, 4);
  assert.equal(stats.toolCompleted, 3);
  assert.equal(stats.toolFailures, 1);
  assert.equal(stats.failureRate, 1 / 3);
  assert.equal(stats.pendingCalls, 1);
  assert.equal(stats.orphanResults, 1);
  assert.equal(stats.toolTimeMs, 400);

  assert.equal(stats.tools.length, 2);
  const [runTests, readFile] = stats.tools;

  assert.equal(runTests.name, 'run_tests');
  assert.equal(runTests.calls, 2);
  assert.equal(runTests.completed, 2);
  assert.equal(runTests.failures, 1);
  assert.equal(runTests.totalMs, 350);
  assert.equal(runTests.avgMs, 175);
  assert.equal(runTests.maxMs, 250);
  assert.equal(runTests.timeShare, 0.875);

  assert.equal(readFile.name, 'read_file');
  assert.equal(readFile.calls, 2);
  assert.equal(readFile.completed, 1);
  assert.equal(readFile.failures, 0);
  assert.equal(readFile.totalMs, 50);
  assert.equal(readFile.avgMs, 50);
  assert.equal(readFile.maxMs, 50);
  assert.equal(readFile.timeShare, 0.125);
});

test('tools are sorted by total time, most expensive first', () => {
  const events: TraceEvent[] = [
    { type: 'tool_call', ts: 0, id: 'a', name: 'cheap', args: null },
    { type: 'tool_result', ts: 10, id: 'a', ok: true, durationMs: 10, output: '', error: null },
    { type: 'tool_call', ts: 0, id: 'b', name: 'expensive', args: null },
    { type: 'tool_result', ts: 1000, id: 'b', ok: true, durationMs: 1000, output: '', error: null },
  ];
  const stats = computeStats(events);
  assert.deepEqual(stats.tools.map((t) => t.name), ['expensive', 'cheap']);
});
