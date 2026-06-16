import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import type { RequestOptions } from "@anthropic-ai/sdk/core.js";
import { v4 as uuidv4 } from "uuid";
import {
  getDb,
  upsertSession,
  updateSessionLastActive,
  closeSession,
  resolveProjectId,
} from "./db.js";
import { computeGCState, MODEL_CONTEXT_WINDOWS } from "./types.js";
import { evaluateCompactionTriggers } from "./evaluate-compaction-triggers.js";
import type { Session, GCState } from "./types.js";
import { computeTurnMetrics, recordTurn } from "./ingest/record-turn.js";
import { LlmPorts } from "./index.js";
import type { CompactionEventSink } from "./domain/compaction-lifecycle-event.js";

interface WrapperOptions {
  sessionName?: string;
  sessionId?: string;
  forkedFrom?: string;
  cwd?: string;
  onGCStateChange?: (state: GCState, ctxPct: number) => void;
  ports?: LlmPorts;
  // Where compaction lifecycle events go. Out-of-process callers pass an HttpEventSink
  // pointed at the Hono server; omitted means events are dropped (noop default downstream).
  eventSink?: CompactionEventSink;
}

interface InstrumentedClient {
  messages: {
    create(
      body: MessageCreateParamsNonStreaming,
      options?: RequestOptions,
    ): Promise<Anthropic.Message>;
  };
  sessionId: string;
  getHealth: () => { ctxPct: number; gcState: GCState; turnCount: number };
  close: () => void;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
export function createInstrumentedClient(
  apiKeyOrClient?: string | Anthropic,
  options: WrapperOptions = {},
): InstrumentedClient {
  const anthropic =
    apiKeyOrClient instanceof Anthropic
      ? apiKeyOrClient
      : new Anthropic({
          apiKey: apiKeyOrClient ?? process.env.ANTHROPIC_API_KEY,
        });

  const db = getDb();
  const sessionId = options.sessionId ?? uuidv4();
  let turnIndex = 0;
  let lastGCState: GCState = "clean";
  let lastOutputText = "";
  let sessionModel = "claude-sonnet-4-6";

  async function create(
    params: MessageCreateParamsNonStreaming,
    requestOptions?: RequestOptions,
  ): Promise<Anthropic.Message> {
    const model = params.model;
    sessionModel = model;
    const ctxWindow = MODEL_CONTEXT_WINDOWS[model] ?? 200_000;

    if (turnIndex === 0) {
      const cwd = options.cwd ?? process.cwd();
      const projectId = resolveProjectId(db, cwd);
      const session: Session = {
        id: sessionId,
        name: options.sessionName ?? null,
        model,
        ctxWindow,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        status: "active",
        outcomeStatus: "unresolved",
        forkedFrom: options.forkedFrom ?? null,
        projectId,
      };
      upsertSession(db, session);
    }

    const start = Date.now();
    const response = await anthropic.messages.create(params, requestOptions);
    const latencyMs = Date.now() - start;

    const { input_tokens, output_tokens } = response.usage;
    const usage = response.usage as AnthropicUsage;
    const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
    const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;

    const outputText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n");

    const turn = computeTurnMetrics({
      sessionId,
      turnIndex: turnIndex++,
      inputTokens: input_tokens,
      outputTokens: output_tokens,
      cacheReadTokens,
      cacheCreationTokens,
      outputText,
      prevOutputText: lastOutputText,
      latencyMs,
      stopReason: response.stop_reason ?? null,
      createdAt: Date.now(),
      model,
      cwd: options.cwd ?? process.cwd(),
      pricingVersion: "claude-sonnet-4-6", // for future-proofing; currently all models use the same pricing
    });

    const { gcState, gcTransitioned } = recordTurn(db, turn, lastGCState);
    updateSessionLastActive(db, sessionId);

    evaluateCompactionTriggers(
      db,
      sessionId,
      turn,
      outputText,
      options.cwd ?? process.cwd(),
      options.ports,
      options.eventSink,
    );

    if (gcTransitioned) {
      options.onGCStateChange?.(gcState, turn.ctxPct);
    }

    lastGCState = gcState;
    lastOutputText = outputText;

    return response;
  }

  return {
    messages: { create },
    sessionId,
    getHealth: () => {
      const ctxWindow = MODEL_CONTEXT_WINDOWS[sessionModel] ?? 200_000;
      const lastTurn = db
        .prepare(
          `SELECT ctx_pct, turn_index FROM turns WHERE session_id = $id ORDER BY turn_index DESC LIMIT 1`,
        )
        .get({ $id: sessionId }) as { ctx_pct: number; turn_index: number } | undefined;
      const ctxPct = lastTurn?.ctx_pct ?? 0;
      return {
        ctxPct,
        gcState: computeGCState(ctxPct),
        turnCount: lastTurn ? lastTurn.turn_index + 1 : 0,
      };
    },
    close: () => closeSession(db, sessionId),
  };
}
