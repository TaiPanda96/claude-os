export function bigrams(text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const bg = new Set<string>();
  for (let i = 0; i < words.length - 1; i++)
    bg.add(`${words[i]} ${words[i + 1]}`);
  return bg;
}
