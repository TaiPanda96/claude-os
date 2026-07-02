---
name: spec
description: Turn a feature idea into a context-efficient, executable spec under docs/specs/. Reconciles against CLAUDE.md invariants and MEMORY.md before writing, verifies "load-bearing facts" against the actual code (never assumes greenfield), and produces a Context → Definition of Done → Scope → Tasks → Testing document. Use when the user asks to spec a feature, or when /synthesis delegates its top-ranked pick.
---

# Spec

Produce a spec an implementer can start from immediately — no more, no less. The discipline is
**context efficiency**: do not restate the codebase. Architectural invariants live in `CLAUDE.md`;
project/feedback context lives in `MEMORY.md`. Reference them by name; paraphrases drift.

## Inputs

- A feature title + intent (from the user, or passed by `/synthesis` with rationale + readiness notes).
- If underspecified, ask 1–3 sharp scoping questions before writing. Don't invent scope.

## Before writing — reconcile (do not skip)

1. **Read `CLAUDE.md`** — list the invariants this feature touches (migrations append-only;
   single-source constants; quality/GC logic has one home; renderer imports bun-free subpaths;
   hook-stop must stay fast; etc.). Cite them; don't re-explain them.
2. **Read `MEMORY.md`** — pull relevant prior decisions and the user's leanings; link by slug
   (`[[name]]`). If a memory names a file/function, verify it still exists.
3. **Verify load-bearing facts against the code.** Grep for the modules/tables/endpoints the
   feature builds on. **Never assume greenfield** — most features extend existing pipelines. State
   what already ships vs. what is the actual gap. This is the single most common spec error.

## Write the spec

Save to `docs/specs/spec-<kebab-title>.md` (this dir is gitignored — specs are local planning
artifacts). Use this structure; keep every section to the minimum that lets an implementer start,
and write "none" rather than padding an empty section:

```md
# Spec: <Title>

**Status:** `draft` · **Date:** <YYYY-MM-DD> · **Phase:** <n>
**One-liner:** <what becomes true when this ships, in one sentence>

## 1. Context — why now, and what's already true
- **Problem / trigger:** <the gap this closes, 2–4 sentences>
- **Load-bearing facts** (verified against code, by path): <existing modules/tables/endpoints built on>
- **Invariants in play** (cite CLAUDE.md, don't restate): <...>
- **Relevant memory** (link MEMORY.md slugs): <[[...]]>
- **Non-goals:** <what this explicitly does NOT do>

## 2. Definition of Done — the acceptance contract
A checklist a reviewer can verify; each item observable (a query returns X, an endpoint exists, a
UI surface renders Y, a test passes).
- [ ] <observable outcome>
- [ ] Typecheck clean; tests for new pure logic pass (`bun run typecheck`, `bun run test`).

## 3. Scope of Work — surface area by layer
| Layer | File(s) | Change |
|-------|---------|--------|
| core  | `packages/core/src/...` | <module / query / migration> |
| server| `packages/server/src/index.ts` | <route / CORS origin> |
| app   | `apps/desktop/src/renderer/...` | <component / config> |
- **New single-source constants:** <where; reference, never duplicate>
- **Migration?** <yes → one appended `MIGRATIONS` entry; or no>

## 4. Tasks — ordered, each independently committable
Dependency-ordered so each step typechecks alone; map to commit scopes (`type(scope): …`).
1. <core: leaf pure logic / types first>
2. <core: wire into queries / engine>
3. <server: expose>
4. <app: consume + render>

## 5. Testing — how each §2 claim is proven
- **Unit (pure fns):** <which fns; bun:test path. Pure domain logic → packages/core, not the renderer.>
- **Manual / integration:** <curl / UI step / ingest run>
- **Edge cases:** <empty input, zero-division, first/last turn, unknown model, etc.>

## 6. Open Questions — deferred decisions, each with a leaning
- <question> — *leaning: <option>, because <reason>*
```

## After writing

Summarize the spec's Definition of Done and its ranked Tasks back to the user, and ask whether to
start implementing task 1 or refine scope. Do not begin implementation from `/spec` unless asked.

> The canonical template also lives at `docs/specs/SPEC_TEMPLATE.md`. If it and this skill drift,
> this skill's embedded structure wins (it's the committed copy).
