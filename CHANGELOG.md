# Changelog

## 0.1.0

- Parser (`parseTrace`, `parseTraceStrict`, `parseTraceLine`) accepts the field
  spellings different agent runtimes actually use (`ts`/`timestamp`,
  `name`/`tool`, `args`/`arguments`, `role`/`type`), normalises timestamps and
  token usage, and reports unparseable lines as issues with a line number
  instead of throwing.
- `pairToolEvents` matches tool_result events to their tool_call by `id`, falls
  back to FIFO matching for results with no id, and reports unmatched results
  as orphans.
- `computeStats` aggregates wall clock time, tool time, per-tool call/failure/
  duration breakdowns and token totals from a parsed event list.
- `renderStats` and `renderTimeline` turn those into the table and timeline
  text the CLI prints.
- `src/cli.ts` adds the `stats` and `show` commands, `--json`, `--tool`,
  `--max-arg`, `--no-text`, `--strict`, stdin input via `-`, `--help` and
  `--version`.
- Test coverage for the parser, pairing, stats and CLI argument handling.
