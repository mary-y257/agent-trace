#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeStats, formatIssue, parseTrace, renderStats, renderTimeline } from './index.ts';

const USAGE = `Usage: agent-trace <command> [options] <file>

Commands:
  stats <file>   totals, per-tool timing, token usage
  show <file>    indented timeline of the session

Options:
  --json          print stats as JSON instead of a table (stats only)
  --tool=<name>   restrict show to a single tool
  --max-arg=<n>   truncate tool arguments to n characters (default 80)
  --no-text       hide user and assistant messages
  --strict        exit 1 if any line failed to parse
  -h, --help      show this help
  --version       show version number

Pass "-" as the file to read the trace from stdin.`;

export interface CliDeps {
  readInput(file: string): string;
  version: string;
}

export interface CliOutput {
  log(text: string): void;
  error(text: string): void;
}

type Command = 'stats' | 'show';

interface Options {
  file: string;
  json: boolean;
  strict: boolean;
  tool: string | undefined;
  maxArgLength: number | undefined;
  showText: boolean | undefined;
}

type OptionsResult = { ok: true; options: Options } | { ok: false; message: string };

/** Runs the CLI against injected I/O so it can be tested without a subprocess. */
export function runCli(argv: readonly string[], deps: CliDeps, out: CliOutput): number {
  const [command, ...rest] = argv;

  if (command === '-h' || command === '--help') {
    out.log(USAGE);
    return 0;
  }
  if (command === '--version') {
    out.log(deps.version);
    return 0;
  }
  if (command !== 'stats' && command !== 'show') {
    out.error(command === undefined ? 'missing command' : `unknown command "${command}"`);
    out.error(USAGE);
    return 2;
  }

  const parsed = parseOptions(command, rest);
  if (!parsed.ok) {
    out.error(parsed.message);
    out.error(USAGE);
    return 2;
  }
  const { file, json, strict, tool, maxArgLength, showText } = parsed.options;

  let text: string;
  try {
    text = deps.readInput(file);
  } catch (err) {
    out.error(`cannot read "${file}": ${(err as Error).message}`);
    return 2;
  }

  const { events, issues } = parseTrace(text);

  if (strict && issues.length > 0) {
    for (const issue of issues) out.error(formatIssue(issue));
    return 1;
  }
  if (events.length === 0) {
    for (const issue of issues) out.error(formatIssue(issue));
    out.error('no usable events in trace');
    return 1;
  }
  if (issues.length > 0) {
    out.error(`skipping ${issues.length} unusable line(s)`);
  }

  if (command === 'stats') {
    const stats = computeStats(events);
    out.log(json ? JSON.stringify(stats, null, 2) : renderStats(stats));
  } else {
    out.log(renderTimeline(events, { tool, maxArgLength, showText }));
  }
  return 0;
}

function parseOptions(command: Command, args: readonly string[]): OptionsResult {
  let file: string | null = null;
  let json = false;
  let strict = false;
  let tool: string | undefined;
  let maxArgLength: number | undefined;
  let showText: boolean | undefined;

  for (const arg of args) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--strict') {
      strict = true;
    } else if (arg === '--no-text') {
      showText = false;
    } else if (arg.startsWith('--tool=')) {
      tool = arg.slice('--tool='.length);
    } else if (arg.startsWith('--max-arg=')) {
      const raw = arg.slice('--max-arg='.length);
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { ok: false, message: `invalid --max-arg value "${raw}"` };
      maxArgLength = n;
    } else if (arg.startsWith('-')) {
      return { ok: false, message: `unknown option "${arg}"` };
    } else if (file === null) {
      file = arg;
    } else {
      return { ok: false, message: `unexpected argument "${arg}"` };
    }
  }

  if (file === null) return { ok: false, message: 'missing <file> argument' };
  if (json && command !== 'stats') return { ok: false, message: '--json only applies to stats' };
  if (command !== 'show' && (tool !== undefined || maxArgLength !== undefined || showText !== undefined)) {
    return { ok: false, message: `${command} does not accept --tool, --max-arg or --no-text` };
  }

  return { ok: true, options: { file, json, strict, tool, maxArgLength, showText } };
}

function readInput(file: string): string {
  return readFileSync(file === '-' ? 0 : file, 'utf8');
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const exitCode = runCli(process.argv.slice(2), { readInput, version: readVersion() }, {
    log: (text) => console.log(text),
    error: (text) => console.error(text),
  });
  process.exit(exitCode);
}
