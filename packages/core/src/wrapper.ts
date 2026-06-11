import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages.js";
import type { RequestOptions } from "@anthropic-ai/sdk/core.js";
import { v4 as uuidv4 } from "uuid";
import {
  getDb,
  insertSession,
  insertTurn,
  insertGCEvent,
  updateSessionLastActive,
  closeSession,
} from "./db.js";
import { computeGCState, MODEL_CONTEXT_WINDOWS } from "./types.js";
import type { Session, Turn, GCEvent, GCState } from "./types.js";
import { bigramOverlap } from "./utils/bigram-overlap.js";
import { countSelfCorrections } from "./utils/count-self-corrections.js";

interface WrapperOptions {
  sessionName?: string;
  sessionId?: string;
  forkedFrom?: string;
  onGCStateChange?: (state: GCState, ctxPct: number) => void;
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
  let cumulativeTokens = 0;
  let turnIndex = 0;
  let lastGCState: GCState = "clean";
  let lastOutputText = "";

  async function create(
    params: MessageCreateParamsNonStreaming,
    requestOptions?: RequestOptions,
  ): Promise<Anthropic.Message> {
    const model = params.model;
    const ctxWindow = MODEL_CONTEXT_WINDOWS[model] ?? 200_000;

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
    const response = await anthropic.messages.create(params, requestOptions);
    const latencyMs = Date.now() - start;

    const { input_tokens, output_tokens } = response.usage;
    cumulativeTokens += input_tokens + output_tokens;
    const ctxPct = cumulativeTokens / ctxWindow;

    const outputText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n");

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
      selfCorrectionCount: countSelfCorrections(outputText),
      repetitionScore: bigramOverlap(lastOutputText, outputText),
      outputDensity: input_tokens > 0 ? output_tokens / input_tokens : 0,
    };

    insertTurn(db, turn);
    updateSessionLastActive(db, sessionId);

    const gcState = computeGCState(ctxPct);
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
    lastOutputText = outputText;

    return response;
  }

  return {
    messages: { create },
    sessionId,
    getHealth: () => {
      const ctxWindow = MODEL_CONTEXT_WINDOWS["claude-sonnet-4-6"] ?? 200_000;
      const ctxPct = cumulativeTokens / ctxWindow;
      return { ctxPct, gcState: computeGCState(ctxPct), turnCount: turnIndex };
    },
    close: () => closeSession(db, sessionId),
  };
}
