import type { TriggerTypeEnum, CompactionFileResult } from "../types.js";

interface BaseLifecycleEvent {
  at: string; // ISO-8601 timestamp
  eventId: string; // == CompactionEvent.id of the owning run
  sessionId: string;
}

/**
 * Lifecycle events emitted during compaction runs, representing discrete moments such as when a run is triggered, started, when files are written, and when it completes or fails.
 * These events are emitted via the `CompactionEventSink` interface,
 * which allows for flexible integration with various event delivery systems,
 * such as in-process logging or out-of-process HTTP webhooks.
 * Each event includes an `eventId` that corresponds to the owning `CompactionEvent` record in the database,
 * enabling correlation between the live event stream and the persisted audit trail.
 * The design of these events and their delivery mechanism ensures that the compaction process remains robust and performant,
 * regardless of the behavior of the event sink, by making the `emit` method fire-and-forget and non-blocking.
 * This allows for comprehensive observability into the compaction process, including what triggered each run,
 * what files were written, and any errors that occurred, without risking disruption to the core workflow.
 */
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
    })
  | (BaseLifecycleEvent & {
      type: "compaction.memory_summarization_failed";
      file: CompactionFileResult;
      error: string;
    });

export type CompactionLifecycleEventType = CompactionLifecycleEvent["type"];

/**
 * Interface between the compaction engine and event delivery mechanisms.
 * Implementations of `CompactionEventSink` receive discrete lifecycle events emitted during a compaction run, such as when a run is triggered, started, when files are written, and when it completes or fails.
 * The `emit` method is designed to be fire-and-forget:
 * implementations must not throw errors or block the execution of the turn,
 * ensuring that the compaction process remains robust
 * and performant regardless of the behavior of the event sink.
 * This allows for flexible integration with various event delivery systems, such as in-process logging or out-of-process HTTP webhooks,
 * without risking disruption to the core compaction workflow.
 */
export interface CompactionEventSink {
  emit(event: CompactionLifecycleEvent): void;
}

export const noopEventSink: CompactionEventSink = {
  emit() {
    /* swallow — used when no consumer is wired up */
  },
};
