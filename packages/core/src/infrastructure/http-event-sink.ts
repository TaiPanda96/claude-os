// Out-of-process implementation of CompactionEventSink.
//
// The live compaction path runs wherever the instrumented client lives — a separate process
// from the Hono server that owns the SSE broadcast. This sink bridges that gap by POSTing
// each lifecycle event to the server's `/webhooks/compaction` ingest endpoint (the "webhook"
// in "fire webhook events that are logged in the server").
//
// Delivery is best-effort and fully non-blocking: a slow or down server must never stall or
// crash the turn, so we never await the fetch and swallow every error.

import type {
  CompactionEventSink,
  CompactionLifecycleEvent,
} from "../domain/compaction-lifecycle-event.js";

const DEFAULT_SERVER_URL = "http://127.0.0.1:7842";

export class HttpEventSink implements CompactionEventSink {
  private readonly endpoint: string;

  constructor(serverUrl: string = process.env.CLAUDE_OS_SERVER_URL ?? DEFAULT_SERVER_URL) {
    this.endpoint = `${serverUrl.replace(/\/$/, "")}/webhooks/compaction`;
  }

  emit(event: CompactionLifecycleEvent): void {
    void fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => {
      /* best-effort: the server may be down, and the turn must not care */
    });
  }
}
