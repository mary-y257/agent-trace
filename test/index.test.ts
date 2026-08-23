import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStats,
  formatIssue,
  pairToolEvents,
  parseTrace,
  parseTraceLine,
  parseTraceStrict,
  renderStats,
  renderTimeline,
  spansByTool,
} from '../src/index.ts';

const SESSION = [
  '{"type":"user","ts":1000,"text":"run the tests"}',
  '{"type":"assistant","ts":1050,"text":"ok","usage":{"input_tokens":10,"output_tokens":2}}',
  '{"type":"tool_call","ts":1100,"id":"c1","name":"run_tests","args":{"suite":"unit"}}',
  '{"type":"tool_result","ts":1300,"id":"c1","ok":true,"output":"3 passed"}',
].join('\n');

test('index re-exports the full public API and it works end to end', () => {
  const { events, issues } = parseTrace(SESSION);
  assert.equal(issues.length, 0);
  assert.equal(events.length, 4);

  assert.deepEqual(parseTraceStrict(SESSION), events);

  const line = parseTraceLine('{"type":"user","text":"hi"}');
  assert.ok(line.ok);

  const { spans, orphans } = pairToolEvents(events);
  assert.equal(spans.length, 1);
  assert.equal(orphans.length, 0);
  assert.equal(spansByTool(spans).get('run_tests')?.length, 1);

  const stats = computeStats(events);
  assert.equal(stats.toolCalls, 1);
  assert.equal(stats.tokens.total, 12);

  assert.match(renderStats(stats), /run_tests/);
  assert.match(renderTimeline(events), /run_tests\(\{"suite":"unit"\}\)/);

  const bad = parseTraceLine('not json');
  assert.ok(!bad.ok);
  assert.match(formatIssue(bad.issue), /not valid json/);
});
