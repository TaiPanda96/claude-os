/**
 * Answers a yes/no question about a slice of session output. Backs the semantic triggers
 * (architectural decision, outcome resolved, and custom classifiers).
 */
export interface ClassifierPort {
  classify(question: string, text: string): Promise<boolean>;
}

/**
 * Summarizes a slice of session output according to the specified prompt and options.
 * Backs the actual compaction step.
 */
export interface SummarizerPort {
  summarize(prompt: string, opts: { merge: boolean; maxTokens: number }): Promise<string>;
}

export interface LlmPorts {
  classifier: ClassifierPort;
  summarizer: SummarizerPort;
}
