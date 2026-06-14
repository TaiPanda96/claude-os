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
  resolveProjectId,
} from "./db.js";
import { computeGCState, MODEL_CONTEXT_WINDOWS } from "./types.js";
import { evaluateCompactionTriggers } from "./evaluate-compaction-triggers.js";
import type { Session, Turn, GCEvent, GCState } from "./types.js";
import { bigramOverlap } from "./utils/bigram-overlap.js";
import { countSelfCorrections } from "./utils/count-self-corrections.js";
import { LlmPorts } from "./index.js";

interface WrapperOptions {
  sessionName?: string;
  sessionId?: string;
  forkedFrom?: string;
  cwd?: string;
  onGCStateChange?: (state: GCState, ctxPct: number) => void;
  ports?: LlmPorts;
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

/**
 * This wrapper around the Anthropic client captures metadata about each message turn
 * and stores it in a SQLite database for later analysis.
 * It also evaluates triggers for context window compaction and logs GC events.
 * @param apiKeyOrClient - The API key or an instance of the Anthropic client.
 * @param options - Configuration options for the wrapper.
 * @returns An instrumented client that wraps the Anthropic client.
 *
 * @example
 * const client = createInstrumentedClient("my-api-key", { sessionName: "Test Session" });
 * const response = await client.messages.create({ model: "claude-2", input: [{ type: "text", text: "Hello" }] });
 * console.log(response);
 * console.log(client.getHealth());
 * client.close();
 */
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

    // Instrumentation for this turn is now captured in `turn`.
    insertTurn(db, turn);
    // Update session's last active timestamp
    updateSessionLastActive(db, sessionId);

    // Evaluate triggers for context window compaction
    // This runs asynchronously and does not block the response to the current turn.
    evaluateCompactionTriggers(
      db,
      sessionId,
      turn,
      outputText,
      options.cwd ?? process.cwd(),
      options.ports,
    );

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
