import Anthropic from "@anthropic-ai/sdk";

export function extractText(content: Anthropic.Message["content"]): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("\n");
}
