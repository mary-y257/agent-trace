/**
 * Public entry point. Everything a caller needs -- parsing, pairing,
 * aggregation and rendering -- is re-exported from here so `agent-trace`
 * can be imported as a single module instead of reaching into `src/*`.
 */
export { parseTrace, parseTraceStrict, parseTraceLine, formatIssue } from './parse.ts';
export type { LineResult } from './parse.ts';

export { pairToolEvents, spansByTool } from './pair.ts';
export type { ToolSpan, OrphanResult, PairedTrace } from './pair.ts';

export { computeStats } from './stats.ts';
export type { ToolStats, TraceStats } from './stats.ts';

export { renderTimeline, renderStats } from './render.ts';
export type { TimelineOptions } from './render.ts';

export type {
  TraceEventType,
  TokenUsage,
  UserEvent,
  AssistantEvent,
  ToolCallEvent,
  ToolResultEvent,
  TraceEvent,
  TraceIssue,
  ParsedTrace,
} from './types.ts';
