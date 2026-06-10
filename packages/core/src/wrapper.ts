import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import { getDb, insertSession, insertTurn, insertGCEvent, updateSessionLastActive } from "./db.js";
import { computeGCState, MODEL_CONTEXT_WINDOWS, GC_THRESHOLDS } from "./types.js";
import type { Session, Turn, GCEvent, GCState } from "./types.js";

interface WrapperOptions {
  sessionName?: string;
  sessionId?: string;
  forkedFrom?: string;
  onGCStateChange?: (state: GCState, ctxPct: number) => void;
}

interface InstrumentedClient {
  messages: {
    create: typeof Anthropic.prototype.messages.create;
  };
  sessionId: string;
  getHealth: () => { ctxPct: number; gcState: GCState; turnCount: number };
}

export function createInstrumentedClient(
  apiKeyOrClient?: string | Anthropic,
  options: WrapperOptions = {}
): InstrumentedClient {
  const anthropic =
    apiKeyOrClient instanceof Anthropic
      ? apiKeyOrClient
      : new Anthropic({ apiKey: apiKeyOrClient ?? process.env.ANTHROPIC_API_KEY });

  const db = getDb();
  const sessionId = options.sessionId ?? uuidv4();
  let cumulativeTokens = 0;
  let turnIndex = 0;
  let lastGCState: GCState = "clean";

  const create: typeof anthropic.messages.create = async (params, requestOptions) => {
    const model = params.model;
    const ctxWindow = MODEL_CONTEXT_WINDOWS[model] ?? 200_000;

    // Lazy-insert session on first turn
    if (turnIndex === 0) {
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
      };
      insertSession(db, session);
    }

    const start = Date.now();
    const response = await anthropic.messages.create(params as never, requestOptions as never);
    const latencyMs = Date.now() - start;

    if ("usage" in response) {
      const { input_tokens, output_tokens } = response.usage;
      cumulativeTokens += input_tokens + output_tokens;
      const ctxPct = cumulativeTokens / ctxWindow;

      const turn: Turn = {
        id: uuidv4(),
        sessionId,
        turnIndex: turnIndex++,
        inputTokens: input_tokens,
        outputTokens: output_tokens,
        cumulativeTokens,
        ctxPct,
        latencyMs,
        stopReason: response.stop_reason ?? null,
        createdAt: Date.now(),
      };
      insertTurn(db, turn);
      updateSessionLastActive(db, sessionId);

      const gcState = computeGCState(ctxPct);

      // Record GC state transitions
      if (gcState !== lastGCState && gcState !== "clean") {
        const gcEvent: GCEvent = {
          id: uuidv4(),
          sessionId,
          gcType: gcState,
          ctxPctAtTrigger: ctxPct,
          createdAt: Date.now(),
        };
        insertGCEvent(db, gcEvent);
        options.onGCStateChange?.(gcState, ctxPct);
      }

      lastGCState = gcState;
    }

    return response;
  };

  return {
    messages: { create },
    sessionId,
    getHealth: () => {
      const ctxWindow = MODEL_CONTEXT_WINDOWS["claude-sonnet-4-6"];
      const ctxPct = cumulativeTokens / ctxWindow;
      return { ctxPct, gcState: computeGCState(ctxPct), turnCount: turnIndex };
    },
  };
}
