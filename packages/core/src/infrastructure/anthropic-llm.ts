import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Resolve repo root from packages/core/src/infrastructure/ (4 levels up) so the
// key is found regardless of whether the caller's cwd is the repo root, a package
// subdir, or an Electron main process spawned from somewhere else entirely.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: resolve(REPO_ROOT, ".env") });
import type { ClassifierPort, SummarizerPort, LlmPorts } from "../domain/llm-ports.js";
import { extractText } from "../utils/extract-text.js";

export enum TypeOfWork {
  MERGE_MODEL = "compaction",
  SUMMARIZATION = "summarization",
  CLASSIFICATION = "classification",
}

export const modelForWork = {
  /**
   * The "merge" model is a higher-capability model used for the most complex compaction step: reconciling a compaction prompt against existing file content.
   * In early testing, this step was more likely to hit failure modes (hallucinating content, missing key details)
   * that caused downstream issues, so we use a stronger model here as a safeguard. The non-merge summarization step, which distills a slice of session output into a memory file without needing to reconcile against existing content, is more straightforward and can be handled by the less expensive summarization model.
   */
  [TypeOfWork.MERGE_MODEL]: "claude-sonnet-4-6",
  /**
   * The summarization model handles the initial distillation of session output into memory file content.
   * This step is important for reducing the token count of the session history, but doesn't require the same level of nuance and detail as the merge step, so we can use a less expensive model here.
   */
  [TypeOfWork.SUMMARIZATION]: "claude-haiku-4-5-20251001",
  /**
   * The classification model is used for the yes/no questions that back the semantic triggers.
   * These questions are typically simpler and more constrained than the summarization tasks, so we can use a less expensive model here as well.
   */
  [TypeOfWork.CLASSIFICATION]: "claude-haiku-4-5-20251001",
};

export class AnthropicLlm implements ClassifierPort, SummarizerPort {
  // Constructed lazily on first use so that importing this module — or building the
  // default ports for a session that has no active policy — never requires an API key.
  private client: Anthropic | null;

  constructor(client?: Anthropic) {
    this.client = client ?? null;
  }

  private getClient(): Anthropic {
    if (process.env.ANTHROPIC_API_KEY === undefined) {
      throw new Error(
        "Anthropic API key not found. Please set the ANTHROPIC_API_KEY environment variable.",
      );
    }
    if (!this.client) this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return this.client;
  }

  async classify(question: string, text: string): Promise<boolean> {
    if (!text.trim()) return false;
    try {
      const response = await this.getClient().messages.create({
        model: modelForWork[TypeOfWork.CLASSIFICATION],
        max_tokens: 5,
        messages: [
          {
            role: "user",
            content: `${question}\n\nSESSION OUTPUT:\n${text.slice(0, 2000)}`,
          },
        ],
      });
      return extractText(response.content).toLowerCase().trim().startsWith("yes");
    } catch {
      return false;
    }
  }

  async summarize(prompt: string, opts: { merge: boolean; maxTokens: number }): Promise<string> {
    const response = await this.getClient().messages.create({
      model: opts.merge
        ? modelForWork[TypeOfWork.MERGE_MODEL]
        : modelForWork[TypeOfWork.SUMMARIZATION],
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return extractText(response.content);
  }
}

// Memoised default so the whole process shares one adapter (and one Anthropic client).
let _default: AnthropicLlm | null = null;
export function llmPortFactory(): LlmPorts {
  if (!_default) _default = new AnthropicLlm();
  return { classifier: _default, summarizer: _default };
}
