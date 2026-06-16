// In-process pub/sub for compaction lifecycle events.
//
// Two producers feed this bus: the server's own manual-compaction route (via an in-process
// CompactionEventSink) and out-of-process callers that POST to /webhooks/compaction. Both
// converge on `publish`, which is the single place that (a) logs every event — the decision
// for this engine is log + broadcast, no event-log table — and (b) fans out to live SSE
// subscribers (the desktop UI).

import type { CompactionEventSink, CompactionLifecycleEvent } from "@claude-os/core";

type Subscriber = (event: CompactionLifecycleEvent) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function publish(event: CompactionLifecycleEvent): void {
  console.log(
    `[compaction-event] ${event.type} session=${event.sessionId} event=${event.eventId}`,
  );
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch (err) {
      // One bad subscriber must not stop the others or crash the request.
      console.error("[compaction-event] subscriber failed", err);
    }
  }
}

// Sink handed to compaction() on the server's own (in-process) path.
export const inProcessEventSink: CompactionEventSink = { emit: publish };
