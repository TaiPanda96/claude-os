import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClassifierPort, SummarizerPort, LlmPorts } from "../domain/llm-ports.js";
import { extractText } from "../utils/extract-text.js";

/**
 * Resolve the repository root by navigating up from the current file's directory.
 * This is used to locate the .env file for loading environment variables, such as the Anthropic API key.
 * By doing this, we ensure that the module can be imported and used from anywhere within the repository without requiring the consumer to set the working directory to a specific location.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
dotenv.config({ path: resolve(REPO_ROOT, ".env") });

export enum TypeOfWork {
  COMPACTION = "compaction",
  SUMMARIZATION = "summarization",
  CLASSIFICATION = "classification",
}

export const modelForWork = {
  /**
   * The "merge" model is a higher-capability model used for the most complex compaction step: reconciling a compaction prompt against existing file content.
   * In early testing, this step was more likely to hit failure modes (hallucinating content, missing key details)
   * that caused downstream issues, so we use a stronger model here as a safeguard. The non-merge summarization step, which distills a slice of session output into a memory file without needing to reconcile against existing content, is more straightforward and can be handled by the less expensive summarization model.
   */
  [TypeOfWork.COMPACTION]: "claude-sonnet-4-6",
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

  /**
   * Classifies a slice of session output according to a yes/no question. Used for the semantic triggers (architectural decision, outcome resolved, and custom classifiers).
   * @param question The yes/no question to classify the session output against.
   * @param text The session output text to classify.
   * @returns A boolean indicating whether the session output satisfies the yes/no question.
   */
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

  /**
   * Summarizes a slice of session output according to the specified prompt and options.
   * @param prompt The prompt to provide to the summarization model.
   * @param opts Options for the summarization, including whether to merge with existing content and the maximum number of tokens.
   * @returns A string containing the summarized output.
   */
  async summarize(prompt: string, opts: { merge: boolean; maxTokens: number }): Promise<string> {
    if (!prompt.trim()) return "";
    const response = await this.getClient().messages.create({
      model: opts.merge
        ? modelForWork[TypeOfWork.COMPACTION]
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
