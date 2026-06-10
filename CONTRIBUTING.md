# Contributing to Claude OS

Claude OS is in early research phase (Phase 0). The most valuable contributions right now are empirical — session data and efficiency curve observations — not code.

## What's most useful right now

**Phase 0 data contributions**
If you run long Claude sessions and are willing to share anonymised token/quality data, open an issue tagged `data`. The efficiency curve hypothesis needs validation across diverse session types (coding, research, writing, debugging).

**Bug reports**
If you're using the `@claude-os/core` wrapper and observe incorrect token counts, schema issues, or GC threshold misfires, open an issue with your model, session length, and the observed vs. expected behaviour.

## Development setup

```bash
git clone https://github.com/TaiPanda96/claude-os.git
cd claude-os
bun install
cd packages/core && cp .env.example .env
# add your ANTHROPIC_API_KEY to .env
```

## Code style

- TypeScript strict mode — no `any`, no `as` casts without a comment explaining why
- No comments explaining what code does — only why, when non-obvious
- Prefer explicit types over inference at module boundaries
- Bun runtime — use Bun APIs where available over Node equivalents

## Commit style

```
type(scope): short description

Types: feat, fix, chore, docs, refactor, test
Scope: core, server, app, menu-bar, analysis, site
```

Examples:
```
feat(core): add self-correction marker detection to quality proxy
fix(server): handle missing session gracefully on /sessions/:id
docs: update Phase 0 status in README
```

## Opening a PR

- One logical change per PR
- Typecheck must pass: `bun run --cwd packages/core typecheck`
- Include a brief description of *why*, not just what changed

## Questions

Open an issue. No Discord, no Slack — issues are the record.
