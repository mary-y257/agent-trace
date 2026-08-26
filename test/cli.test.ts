import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli.ts';
import type { CliDeps, CliOutput } from '../src/cli.ts';

const SESSION = [
  '{"type":"user","ts":1000,"text":"run the tests"}',
  '{"type":"tool_call","ts":1100,"id":"c1","name":"run_tests","args":{"suite":"unit"}}',
  '{"type":"tool_result","ts":1300,"id":"c1","ok":true,"output":"3 passed"}',
].join('\n');

function fakeDeps(files: Record<string, string>): CliDeps {
  return {
    version: '9.9.9',
    readInput(file) {
      if (!(file in files)) throw new Error('ENOENT: no such file');
      return files[file];
    },
  };
}

function capture(): CliOutput & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (text) => logs.push(text),
    error: (text) => errors.push(text),
  };
}

test('--help prints usage and exits 0', () => {
  const out = capture();
  const code = runCli(['--help'], fakeDeps({}), out);
  assert.equal(code, 0);
  assert.match(out.logs.join('\n'), /Usage: agent-trace/);
});

test('--version prints the injected version and exits 0', () => {
  const out = capture();
  const code = runCli(['--version'], fakeDeps({}), out);
  assert.equal(code, 0);
  assert.deepEqual(out.logs, ['9.9.9']);
});

test('an unknown command exits 2 with usage on stderr', () => {
  const out = capture();
  const code = runCli(['bogus', 'file.jsonl'], fakeDeps({}), out);
  assert.equal(code, 2);
  assert.match(out.errors[0], /unknown command "bogus"/);
});

test('a missing command exits 2', () => {
  const out = capture();
  const code = runCli([], fakeDeps({}), out);
  assert.equal(code, 2);
  assert.match(out.errors[0], /missing command/);
});

test('a missing file argument exits 2', () => {
  const out = capture();
  const code = runCli(['stats'], fakeDeps({}), out);
  assert.equal(code, 2);
  assert.match(out.errors[0], /missing <file>/);
});

test('an unreadable file exits 2', () => {
  const out = capture();
  const code = runCli(['stats', 'missing.jsonl'], fakeDeps({}), out);
  assert.equal(code, 2);
  assert.match(out.errors[0], /cannot read "missing\.jsonl"/);
});

test('stats renders the summary table by default', () => {
  const out = capture();
  const code = runCli(['stats', 'session.jsonl'], fakeDeps({ 'session.jsonl': SESSION }), out);
  assert.equal(code, 0);
  assert.match(out.logs[0], /run_tests/);
});

test('stats --json prints parseable JSON with the expected shape', () => {
  const out = capture();
  const code = runCli(['stats', '--json', 'session.jsonl'], fakeDeps({ 'session.jsonl': SESSION }), out);
  assert.equal(code, 0);
  const stats = JSON.parse(out.logs[0]);
  assert.equal(stats.toolCalls, 1);
});

test('--json on show is rejected as a usage error', () => {
  const out = capture();
  const code = runCli(['show', '--json', 'session.jsonl'], fakeDeps({ 'session.jsonl': SESSION }), out);
  assert.equal(code, 2);
  assert.match(out.errors[0], /--json only applies to stats/);
});

test('show-only options are rejected on stats', () => {
  const out = capture();
  const code = runCli(['stats', '--tool=run_tests', 'session.jsonl'], fakeDeps({ 'session.jsonl': SESSION }), out);
  assert.equal(code, 2);
  assert.match(out.errors[0], /does not accept --tool/);
});

test('show --tool filters the timeline to one tool', () => {
  const out = capture();
  const code = runCli(['show', '--tool=run_tests', 'session.jsonl'], fakeDeps({ 'session.jsonl': SESSION }), out);
  assert.equal(code, 0);
  assert.match(out.logs[0], /run_tests/);
  assert.equal(out.logs[0].includes('run the tests'), false);
});

test('show --no-text hides user and assistant lines', () => {
  const out = capture();
  const code = runCli(['show', '--no-text', 'session.jsonl'], fakeDeps({ 'session.jsonl': SESSION }), out);
  assert.equal(code, 0);
  assert.equal(out.logs[0].includes('run the tests'), false);
});

test('an invalid --max-arg value is a usage error', () => {
  const out = capture();
  const code = runCli(['show', '--max-arg=nope', 'session.jsonl'], fakeDeps({ 'session.jsonl': SESSION }), out);
  assert.equal(code, 2);
  assert.match(out.errors[0], /invalid --max-arg value/);
});

test('an unknown option is a usage error', () => {
  const out = capture();
  const code = runCli(['stats', '--bogus', 'session.jsonl'], fakeDeps({ 'session.jsonl': SESSION }), out);
  assert.equal(code, 2);
  assert.match(out.errors[0], /unknown option "--bogus"/);
});

test('a trace with no usable events exits 1', () => {
  const out = capture();
  const code = runCli(['stats', 'empty.jsonl'], fakeDeps({ 'empty.jsonl': '' }), out);
  assert.equal(code, 1);
  assert.match(out.errors[0], /no usable events/);
});

test('--strict exits 1 and reports every bad line when parsing failed', () => {
  const bad = `${SESSION}\nnot json`;
  const out = capture();
  const code = runCli(['stats', '--strict', 'session.jsonl'], fakeDeps({ 'session.jsonl': bad }), out);
  assert.equal(code, 1);
  assert.match(out.errors[0], /not valid json/);
});

test('without --strict, bad lines are skipped with a warning but the run still succeeds', () => {
  const bad = `${SESSION}\nnot json`;
  const out = capture();
  const code = runCli(['stats', 'session.jsonl'], fakeDeps({ 'session.jsonl': bad }), out);
  assert.equal(code, 0);
  assert.match(out.errors[0], /skipping 1 unusable line\(s\)/);
});

test('"-" is passed through to readInput unchanged for stdin support', () => {
  const out = capture();
  const code = runCli(['stats', '-'], fakeDeps({ '-': SESSION }), out);
  assert.equal(code, 0);
  assert.match(out.logs[0], /run_tests/);
});
