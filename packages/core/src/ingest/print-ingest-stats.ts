import { Database } from "../db";

// ── Stats ─────────────────────────────────────────────────────────────────────
export function printIngestStats(
  db: Database,
  {
    databasePath,
  }: {
    databasePath: string;
  },
) {
  const sessions = db.prepare(`SELECT COUNT(*) as n FROM sessions`).get() as {
    n: number;
  };
  const turns = db.prepare(`SELECT COUNT(*) as n FROM turns`).get() as {
    n: number;
  };
  const gcEvents = db.prepare(`SELECT COUNT(*) as n FROM gc_events`).get() as {
    n: number;
  };

  console.log(`\n\x1b[1mClaude OS — DB Summary\x1b[0m`);
  console.log(`  Sessions:  ${sessions.n}`);
  console.log(`  Turns:     ${turns.n}`);
  console.log(`  GC events: ${gcEvents.n}`);
  console.log(`  DB path:   ${databasePath}\n`);

  const rows = db
    .prepare(
      `
    SELECT s.id, s.name, s.model,
      COUNT(t.id) as turn_count,
      MAX(t.ctx_pct) as max_ctx_pct,
      MAX(t.effective_input_tokens) as max_effective_input
    FROM sessions s
    LEFT JOIN turns t ON t.session_id = s.id
    GROUP BY s.id
    ORDER BY s.last_active_at DESC
    LIMIT 20
  `,
    )
    .all() as Array<{
    id: string;
    name: string | null;
    model: string;
    turn_count: number;
    max_ctx_pct: number;
    max_effective_input: number;
  }>;

  if (rows.length === 0) {
    console.log("  No data yet. Run ingest first.\n");
    return;
  }

  console.log(
    `${"session".padEnd(10)} ${"turns".padStart(5)} ${"max ctx%".padStart(9)} ${"model".padEnd(28)} name`,
  );
  console.log("─".repeat(80));
  for (const r of rows) {
    const gc =
      r.max_ctx_pct >= 0.8
        ? "\x1b[31m"
        : r.max_ctx_pct >= 0.6
          ? "\x1b[33m"
          : "\x1b[32m";
    console.log(
      `${r.id.slice(0, 8).padEnd(10)} ` +
        `${String(r.turn_count).padStart(5)} ` +
        `${gc}${(r.max_ctx_pct * 100).toFixed(1).padStart(8)}%\x1b[0m ` +
        `${r.model.padEnd(28)} ` +
        `${r.name ?? "—"}`,
    );
  }
  console.log();
}
