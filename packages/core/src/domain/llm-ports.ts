// Ports (interfaces) for the LLM-backed steps of the compaction engine.
//
// The domain/application code (trigger-evaluator.ts, compaction.ts) depends on these
// interfaces, never on a concrete SDK. The Anthropic implementation — including which
// model each step uses — lives in ../infrastructure/anthropic-llm.ts. Swapping providers,
// or faking the LLM in a test, means supplying a different LlmPorts; no domain code changes.

// Answers a yes/no question about a slice of session output. Backs the semantic triggers
// (architectural decision, outcome resolved, and custom classifiers).
export interface ClassifierPort {
  classify(question: string, text: string): Promise<boolean>;
}

// Distils a compaction prompt into memory-file content. `merge` selects the
// higher-capability model used when reconciling against existing file content.
export interface SummarizerPort {
  summarize(
    prompt: string,
    opts: { merge: boolean; maxTokens: number },
  ): Promise<string>;
}

export interface LlmPorts {
  classifier: ClassifierPort;
  summarizer: SummarizerPort;
}
