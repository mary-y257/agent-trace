import { pairToolEvents } from './pair.ts';
import type { OrphanResult, ToolSpan } from './pair.ts';
import type { AssistantEvent, TraceEvent } from './types.ts';
import type { ToolStats, TraceStats } from './stats.ts';

export interface TimelineOptions {
  /** Only show calls (and their results) for this tool name. */
  tool?: string;
  /** Truncate tool_call args to this many characters. Default 80. */
  maxArgLength?: number;
  /** Include user/assistant lines. Default true; forced off when `tool` is set. */
  showText?: boolean;
}

const DEFAULT_MAX_ARG_LENGTH = 80;
const LABEL_WIDTH = 14;
const TYPE_WIDTH = 11;
const OFFSET_WIDTH = 9;

/** Render the summary table produced by {@link computeStats}. */
export function renderStats(stats: TraceStats): string {
  const lines: string[] = [
    labelLine('events', `${stats.events}  (${byTypeSummary(stats)})`),
    labelLine('wall clock', stats.wallClockMs === null ? 'n/a' : formatDuration(stats.wallClockMs)),
    labelLine('tool time', formatToolTime(stats)),
    labelLine('tool calls', formatToolCalls(stats)),
    labelLine('tokens', `${stats.tokens.input} in / ${stats.tokens.output} out = ${stats.tokens.total} total`),
  ];

  if (stats.tools.length > 0) {
    lines.push('', renderToolTable(stats.tools));
  }

  return lines.join('\n');
}

/** Render the events in chronological order, one line each. */
export function renderTimeline(events: readonly TraceEvent[], options: TimelineOptions = {}): string {
  const maxArgLength = options.maxArgLength ?? DEFAULT_MAX_ARG_LENGTH;
  const toolFilter = options.tool;
  // A tool filter narrows the timeline to one tool's activity, so text lines
  // (which never belong to a tool) would just be noise.
  const showText = (options.showText ?? true) && !toolFilter;

  const firstTs = firstTimestamp(events);
  const { spans, orphans } = pairToolEvents(events);
  const spanByCallIndex = new Map(spans.map((span) => [span.callIndex, span]));
  const orphanByIndex = new Map(orphans.map((orphan) => [orphan.index, orphan]));

  const lines: string[] = [];
  events.forEach((event, index) => {
    if (event.type === 'user') {
      if (showText) lines.push(formatSimple('user', event.ts, firstTs, collapseWhitespace(event.text)));
      return;
    }
    if (event.type === 'assistant') {
      if (showText) lines.push(formatSimple('assistant', event.ts, firstTs, formatAssistantText(event)));
      return;
    }
    if (event.type === 'tool_call') {
      const span = spanByCallIndex.get(index);
      if (!span || (toolFilter && span.call.name !== toolFilter)) return;
      lines.push(formatSpan(span, firstTs, maxArgLength));
      return;
    }
    // tool_result: rendered above as part of its span, unless it never found one.
    if (toolFilter) return;
    const orphan = orphanByIndex.get(index);
    if (orphan) lines.push(formatOrphan(orphan, firstTs));
  });

  return lines.join('\n');
}

function firstTimestamp(events: readonly TraceEvent[]): number | null {
  let first: number | null = null;
  for (const event of events) {
    if (event.ts !== null && (first === null || event.ts < first)) first = event.ts;
  }
  return first;
}

function labelLine(label: string, value: string): string {
  return `${label.padEnd(LABEL_WIDTH)}${value}`;
}

function byTypeSummary(stats: TraceStats): string {
  const { user, assistant, tool_call, tool_result } = stats.byType;
  return `user ${user}, assistant ${assistant}, tool_call ${tool_call}, tool_result ${tool_result}`;
}

function formatToolTime(stats: TraceStats): string {
  const time = formatDuration(stats.toolTimeMs);
  if (!stats.wallClockMs) return time;
  return `${time}  (${formatPercent(stats.toolTimeMs / stats.wallClockMs)} of wall clock)`;
}

function formatToolCalls(stats: TraceStats): string {
  const rate = formatPercent(stats.failureRate);
  return (
    `${stats.toolCalls}  (${stats.toolCompleted} completed, ${stats.pendingCalls} pending, ` +
    `${stats.toolFailures} failed = ${rate} failure rate)`
  );
}

function renderToolTable(tools: readonly ToolStats[]): string {
  const header = ['tool', 'calls', 'fail', 'total', 'avg', 'max', 'share'];
  const alignRight = [false, true, true, true, true, true, true];
  const rows = tools.map((tool) => [
    tool.name,
    String(tool.calls),
    String(tool.failures),
    formatDuration(tool.totalMs),
    tool.avgMs === null ? 'n/a' : formatDuration(tool.avgMs),
    tool.maxMs === null ? 'n/a' : formatDuration(tool.maxMs),
    formatPercent(tool.timeShare),
  ]);

  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => row[i].length)));
  const formatRow = (cells: readonly string[]): string =>
    cells.map((cell, i) => (alignRight[i] ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join('  ').trimEnd();

  return [formatRow(header), ...rows.map(formatRow)].join('\n');
}

function formatSimple(label: string, ts: number | null, firstTs: number | null, text: string): string {
  return `${formatOffset(ts, firstTs)}  ${label.padEnd(TYPE_WIDTH)}  ${text}`;
}

function formatAssistantText(event: AssistantEvent): string {
  const text = collapseWhitespace(event.text);
  if (!event.usage) return text;
  const usage = `[${event.usage.input} in / ${event.usage.output} out]`;
  return text === '' ? usage : `${text}  ${usage}`;
}

function formatSpan(span: ToolSpan, firstTs: number | null, maxArgLength: number): string {
  const head =
    `${formatOffset(span.call.ts, firstTs)}  ${'tool_call'.padEnd(TYPE_WIDTH)}  ` +
    `${span.call.name}(${formatArgs(span.call.args, maxArgLength)})`;

  if (span.result === null) return `${head}  -> pending`;

  const duration = span.durationMs === null ? '' : ` in ${formatDuration(span.durationMs)}`;
  if (span.ok === false) {
    const reason = span.result.error ? `: ${collapseWhitespace(span.result.error)}` : '';
    return `${head}  -> failed${duration}${reason}`;
  }
  return `${head}  -> ok${duration}`;
}

function formatOrphan(orphan: OrphanResult, firstTs: number | null): string {
  const idPart = orphan.event.id === null ? '' : ` id=${orphan.event.id}`;
  const duration = orphan.event.durationMs === null ? '' : ` in ${formatDuration(orphan.event.durationMs)}`;
  const status = orphan.event.ok ? 'ok' : 'failed';
  return (
    `${formatOffset(orphan.event.ts, firstTs)}  ${'tool_result'.padEnd(TYPE_WIDTH)}  ` +
    `(orphan${idPart})  -> ${status}${duration}`
  );
}

function formatOffset(ts: number | null, firstTs: number | null): string {
  if (ts === null || firstTs === null) return 'n/a'.padStart(OFFSET_WIDTH);
  return `+${((ts - firstTs) / 1000).toFixed(3)}s`.padStart(OFFSET_WIDTH);
}

function formatArgs(args: unknown, maxArgLength: number): string {
  if (args === undefined || maxArgLength <= 0) return '';
  let text: string;
  try {
    text = JSON.stringify(args) ?? 'undefined';
  } catch {
    text = String(args);
  }
  return text.length > maxArgLength ? `${text.slice(0, maxArgLength)}…` : text;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(3)}s` : `${Math.round(ms)}ms`;
}

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
