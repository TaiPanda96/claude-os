import { appendFileSync, writeFileSync } from "fs";
import { join } from "path";
import { MemoryFile, CompactionFileResult } from "../types";
import { ensureDir } from "./ensure-dir-exists";

export async function writeMemoryFileToDir(
  dir: string,
  file: MemoryFile,
  content: string,
): Promise<CompactionFileResult> {
  ensureDir(dir);
  const filePath = join(dir, file.filename);
  const bytes = Buffer.byteLength(content, "utf-8");

  if (file.update_mode === "append") {
    const separator = `\n---\n<!-- compacted ${new Date().toISOString()} -->\n`;
    appendFileSync(filePath, separator + content, "utf-8");
  } else {
    writeFileSync(filePath, content, "utf-8");
  }

  return {
    filename: file.filename,
    update_mode: file.update_mode,
    bytes_written: bytes,
    content,
  };
}
