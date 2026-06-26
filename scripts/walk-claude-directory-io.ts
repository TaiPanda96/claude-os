import { ingestJsonLFile } from "@claude-os/core/ingest/ingest-jsonl-file";
import { Database } from "@claude-os/core/types";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

export function walkClaudeDirectoryIo(
  db: Database,
  inputs: {
    projectDirRoot: string;
    values: {
      project?: string;
      file?: string;
      stats: boolean;
      db: string;
      verbose: boolean;
    };
  },
) {
  const { values, projectDirRoot } = inputs;
  let totalSessions = 0,
    totalTurns = 0,
    totalSkipped = 0;

  if (values.file) {
    if (!existsSync(values.file)) {
      console.error(`File not found: ${values.file}`);
      process.exit(1);
    }
    console.log(`Ingesting ${values.file}...`);
    const r = ingestJsonLFile(db, values.file, { verbose: true });
    totalSessions += r.sessions;
    totalTurns += r.turns;
    totalSkipped += r.skipped;
  } else {
    // Walk ~/.claude/projects/
    const projectDirs = readdirSync(projectDirRoot).filter((d) => {
      if (values.project) return d.includes(values.project);
      return true;
    });

    for (const projectDir of projectDirs) {
      const dir = join(projectDirRoot, projectDir);
      let jsonlFiles: string[];
      try {
        jsonlFiles = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }

      if (jsonlFiles.length === 0) continue;
      if (!values.verbose) process.stdout.write(`${projectDir.slice(0, 50).padEnd(52)}`);

      for (const file of jsonlFiles) {
        const r = ingestJsonLFile(db, join(dir, file), { verbose: values.verbose });
        totalSessions += r.sessions;
        totalTurns += r.turns;
        totalSkipped += r.skipped;
      }
      if (!values.verbose) console.log(`${jsonlFiles.length} file(s)`);
    }
  }
  console.log(
    `\n\x1b[32m✓\x1b[0m Ingested ${totalTurns} new turns across ${totalSessions} sessions (${totalSkipped} already present)\n`,
  );
}
