### Claude OS Phase 0 has the following architecture
CLI
 → discover input files
 → parse JSONL records
 → normalize into domain rows
 → persist via repository
 → report result

### Turn Lifecycle

  Turn lifecycle: user → Claude → Stop hook → SQLite

  ┌──────────────┐
  │  Claude Code  │  user prompts, Claude responds — each exchange appends
  │   session     │  user/assistant records to the session transcript:
  └──────┬────────┘  ~/.claude/projects/<encoded-cwd>/<session_id>.jsonl
         │
         │  turn completes → Claude Code fires the Stop hook
         │  (blocks until the hook exits; passes JSON on stdin)
         ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  scripts/hook-stop.ts        (the live feed)                  │
  │                                                               │
  │  1. read stdin → { session_id, transcript_path }              │
  │  2. findJsonlForSession()  → resolve the .jsonl path          │
  │         · use transcript_path if it exists                    │
  │         · else scan ~/.claude/projects for a file whose       │
  │           name contains session_id                            │
  │  3. open SQLite (WAL, FK on) + initializeSchemas()            │
  │  4. ingestJsonLFile(db, filePath)                             │
  │  5. db.close(); exit 0  (always — never blocks Claude Code)   │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  ingestJsonLFile()       (shared by hook + bulk ingest.ts)    │
  │                                                               │
  │  • parse every JSONL line → records                           │
  │  • index user records by uuid       (for latency)             │
  │  • group assistant records by sessionId, sort by timestamp    │
  │  • upsertSession(...)                                          │
  │  • for each assistant turn:                                   │
  │      computeTurnMetrics()  → ctxPct, outputDensity,           │
  │                              selfCorrection, repetitionScore  │
  │      recordTurn()          → INSERT OR IGNORE                 │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  claude-os.sqlite                                             │
  │    sessions   ← upsertSession                                │
  │    turns      ← INSERT OR IGNORE (UNIQUE session_id,turn_idx)│  ← idempotent
  │    gc_events  ← on first GC state transition (Soft/Hard/Aged)│
  └─────────────────────────────────────────────────────────────┘
  └─────────────────────────────────────────────────────────────┘


### Unified turn pipeline — single source of truth

Both paths write through the same functions in `packages/core/src/ingest/record-turn.ts`:

```
ingest.ts  (backfill)       hook-stop.ts / wrapper.ts  (live)
     │                                  │
     │  AssistantRecord (JSONL)         │  Anthropic.Message (SDK response)
     │                                  │
     └──────────────┬───────────────────┘
                    │
                    ▼
          computeTurnMetrics(RawTurnInput)
          ─ effectiveInput = input + cache_read + cache_creation
          ─ ctxPct = min(effectiveInput / ctxWindow, 1.0)
          ─ outputDensity = outputTokens / effectiveInput
          ─ selfCorrectionCount, repetitionScore
                    │
                    ▼
          recordTurn(db, turn, prevGCState)
          ─ INSERT OR IGNORE on (session_id, turn_index) — idempotent
          ─ GC event written on first state transition per session
```

**Why this matters:** running `ingest.ts` after a live session (or vice versa) produces no duplicate rows — the `UNIQUE INDEX ON turns(session_id, turn_index)` enforces dedup regardless of which path wrote first. Metric definitions (`ctxPct`, `outputDensity`) are guaranteed identical across both paths.


### `ingest.ts` is the one time ETL for prior claude code sessions
ingest.ts — the backfill
This is a one-shot ETL script. Its job is to bootstrap the database with historical data. Claude Code has been writing every session to JSONL since the first time you used it — ingest.ts reads all of that retroactively.

It walks ~/.claude/projects/, parses every .jsonl file, pairs user and assistant records, computes per-turn metrics, and writes them to SQLite via ingestJsonLFile. INSERT OR IGNORE makes it idempotent — you can re-run it safely as sessions accumulate.

In roadmap terms, this is purely a Phase 0 tool. Its entire purpose is to give the analysis notebook enough real session data to validate the efficiency curve hypothesis. Once Phase 1 ships (the menu bar sprite polling SQLite in real time), ingest.ts becomes less critical — it's the scaffold you tear down once the live pipeline is stable. But for now it's what gives you 138 sessions and 9,435 turns to work with immediately.


### `hook-stop.ts` — the live feed daemon callback
This is a daemon callback. Claude Code fires it automatically at the end of every agent loop via the Stop hook in ~/.claude/settings.json. It receives the current session ID and transcript path on stdin, reads the JSONL file, and incrementally writes new turns to SQLite via `ingestJsonLFile` → `recordTurn`.

The key design constraint: it must be fast and silent. Claude Code waits for the hook to exit before returning control to you. If it hangs or errors loudly, it degrades your Claude Code experience. That's why it exits 0 unconditionally and does no network I/O.

In roadmap terms, this is the Phase 1 prerequisite. The menu bar sprite needs to poll SQLite every 5 seconds to show real-time context depth — that only works if the data is flowing in continuously. hook-stop.ts is what makes SQLite a live mirror of your active sessions rather than a historical archive.


### `wrapper.ts` — programmatic SDK instrumentation
`createInstrumentedClient` wraps the Anthropic SDK client and is the entry point when you control the call site directly (e.g. in your own scripts or agents built on top of `@claude-os/core`). Each `messages.create` call goes through the same `computeTurnMetrics` → `recordTurn` pipeline as the hook, so metrics are identical.

Key differences from `hook-stop.ts`:
- **Timing:** latency is measured as wall-clock ms around the SDK call, rather than derived from JSONL timestamps
- **Compaction:** `wrapper.ts` is the only path that calls `evaluateCompactionTriggers` — the hook relies on JSONL replay and doesn't re-evaluate policy triggers for historical turns
- **Session lifecycle:** the wrapper manages session open (`upsertSession`) and close (`closeSession`) explicitly; the hook just appends turns to whatever session the JSONL describes

Use `hook-stop.ts` when you want zero-config instrumentation of all Claude Code sessions. Use `wrapper.ts` when you're building a tool that calls the Anthropic API directly and wants the same observability.