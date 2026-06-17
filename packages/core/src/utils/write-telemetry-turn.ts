import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { telemetryDir } from "./memory-dir.js";
import { ensureDir } from "./ensure-dir-exists.js";

export interface TelemetryTurnRecord {
  id: string; // UUID minted at write time
  session_id: string;
  turn_index: number;
  cwd: string;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  cumulative_tokens: number;
  ctx_pct: number;
  model: string;
  stop_reason: string | null;
  // Actual content from the JSONL record
  user_text: string | null;
  assistant_text: string | null;
}

export function writeTelemetryTurn(cwd: string, record: Omit<TelemetryTurnRecord, "id">): string {
  const dir = telemetryDir(cwd);
  ensureDir(dir);
  const id = uuidv4();
  const full: TelemetryTurnRecord = { id, ...record };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(full, null, 2), "utf-8");
  return id;
}
