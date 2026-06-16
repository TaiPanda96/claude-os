// Lifecycle event stream for a compaction run.
//
// This is distinct from the `CompactionEvent` aggregate in ../types.ts: that type is the
// durable audit *record* of a whole run (one row, mutated running → completed | failed),
// whereas a CompactionLifecycleEvent is one discrete, immutable signal emitted at a moment
// in time. The stream is what gets webhooked to the server and re-broadcast over SSE.
//
// Every event carries `eventId`, the id of the owning `CompactionEvent` row, so a consumer
// can correlate the live stream back to the persisted audit record.

import type { TriggerTypeEnum, CompactionFileResult } from "../types.js";

interface BaseLifecycleEvent {
  eventId: string; // == CompactionEvent.id of the owning run
  sessionId: string;
  at: string; // ISO-8601 timestamp
}

export type CompactionLifecycleEvent =
  | (BaseLifecycleEvent & {
      type: "compaction.triggered";
      policyId: string;
      triggeredBy: TriggerTypeEnum;
      detail: string;
    })
  | (BaseLifecycleEvent & {
      type: "compaction.started";
      policyId: string;
      triggeredBy: TriggerTypeEnum;
      tokensAtTrigger: number;
    })
  | (BaseLifecycleEvent & {
      type: "compaction.file_written";
      file: CompactionFileResult;
    })
  | (BaseLifecycleEvent & {
      type: "compaction.completed";
      filesWritten: CompactionFileResult[];
    })
  | (BaseLifecycleEvent & {
      type: "compaction.failed";
      error: string;
    });

export type CompactionLifecycleEventType = CompactionLifecycleEvent["type"];

// The seam between the compaction engine and however events are delivered. `emit` is
// fire-and-forget by contract: implementations MUST NOT throw and MUST NOT block the turn
// (the live path runs inside a Claude Code Stop hook). Default is the no-op sink below.
export interface CompactionEventSink {
  emit(event: CompactionLifecycleEvent): void;
}

export const noopEventSink: CompactionEventSink = {
  emit() {
    /* swallow — used when no consumer is wired up */
  },
};
