import { existsSync, readFileSync } from "fs";

export function readDir(filePath: string, capChars: number): string {
  if (!existsSync(filePath)) return "";
  const content = readFileSync(filePath, "utf-8");
  return content.slice(0, capChars * 4);
}
