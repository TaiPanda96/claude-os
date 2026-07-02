---
name: synthesis
description: Staff-engineer synthesis ritual — review recent git diffs for architectural/boundary impact, assess how they move the product roadmap, produce a stack-ranked highest-leverage feature list with rationale, then delegate the top pick(s) to /spec. Use when deciding what to build next, planning the next high-leverage work after shipping a change, or when the user asks "where are we / what's next".
---

# Synthesis

The staff-engineer ritual: look at what just shipped, look at the roadmap, and answer one
question — **what are the next highest-leverage, load-bearing decisions to advance the
roadmap?** Then turn the top answer into an executable spec.

Synthesis is *judgment work*, not a status report. The output is a ranked set of decisions with
rationale, not a list of everything that could be done. Bias toward the few choices that unblock
the most downstream work or are expensive to get wrong.

## Inputs

- **Range** (optional arg): the git range to review. Default to "since the last merge to the
  main branch" — i.e. `git log origin/main..HEAD` if on a feature branch, else the last ~15
  commits (`git log -15`) or since the last tag. Accept an explicit range (`v0.3..HEAD`, a date,
  a commit SHA) when given.
- **Focus** (optional arg): a subsystem or phase to weight the ranking toward.

## Where the ground truth lives (this repo)

- **Roadmap:** the `## Roadmap` section of `README.md` (phase checklist) **and** `docs/specs/`
  (active specs = backlog) vs `docs/specs/done/` (shipped). These are the two halves of the
  roadmap — reconcile them.
- **Invariants & architecture:** `CLAUDE.md` (boundaries, single-source rules), `ARCHITECTURE.md`,
  `MEMORY.md` (project/feedback memory — read it for prior decisions and the user's leanings).
- **Reference by name; never restate.** When citing an invariant or a memory, link/cite it.

## Step 1 — Git Diff Review → system boundaries & architectural patterns

Read the diffs in range and characterize them *structurally*, not feature-by-feature. Answer:

- **Boundaries:** What service/package/module boundaries did this cross, introduce, or harden?
  (e.g. "calculation moved from renderer → core domain"; "new bun-free subpath".)
- **Patterns:** What architectural pattern was established or extended that future work should
  follow? (e.g. "declarative registry + generic engine"; "structural input types across the wire".)
- **New invariants / debt:** What must now stay true (a constraint future PRs can break)? What
  shortcut or TODO was left that is now load-bearing?
- **Surface delta:** New tables, endpoints, types, constants, migrations — the new API surface.

For a substantial range, delegate this to a read-only subagent (Explore/general-purpose) so the
diff dump stays out of context; ask it to return the structural summary above, not file contents.

## Step 2 — Product Roadmap Diff → impact on the roadmap

Reconcile the README phases + `docs/specs/` against what Step 1 shows is now true in the code:

- **Newly done:** Which roadmap items / specs are now satisfied? (Flag specs to move to
  `docs/specs/done/`.)
- **Newly unblocked:** What was waiting on what just shipped, and is now buildable?
- **Newly load-bearing:** What did this change make more central — a foundation later work now
  depends on?
- **Shifted or invalidated:** Did any planned item become unnecessary, superseded (e.g. a v2 spec
  now covered by v3), or need re-scoping?

Verify claims against the code — do not trust a spec's stated status. (A spec can say "draft"
while its work has shipped, or vice-versa.)

## Step 3 — Prioritized Feature List → stack ranking with rationale

Produce a **stack-ranked** list of the next candidate decisions/features. Rank by *leverage*,
scoring each against this rubric (high / med / low):

| Factor | Question |
|--------|----------|
| **Load-bearing** | How much downstream work does this unblock or de-risk? |
| **Reversibility** | How expensive is it to get wrong / change later? (Less reversible → decide sooner.) |
| **Phase fit** | Does it advance the current roadmap phase, or skip ahead? |
| **Readiness** | Are the prerequisites (from Step 2) actually in place now? |
| **Effort** | Rough cost (S/M/L). A high-leverage S beats a high-leverage L. |

For each ranked item give **2–4 sentences of rationale** tying it to Steps 1–2 — *why this, why
now, why this rank*. Name the one or two genuinely load-bearing decisions explicitly; the rest is
ordered backlog. Call out anything you deliberately ranked *down* and why (avoid silent omission).

## Step 4 — Delegate to /spec

For the **top-ranked** item (or top 1–2 if cheap and independent), invoke the `/spec` skill to
produce the executable spec — pass it the feature title and the rationale + readiness notes from
Step 3 as context so it doesn't re-derive them. Do not hand-write the spec here; `/spec` owns the
template and the `CLAUDE.md`/`MEMORY.md` reconciliation. Lower-ranked items stay as the ordered
backlog for the next synthesis.

If the user only wants the analysis (not a spec yet), stop after Step 3 and present the ranking.

## Output

Present the synthesis inline (Steps 1–3) and persist a dated record to
`docs/synthesis/YYYY-MM-DD-synthesis.md` (a staff-eng decision trail). Keep the report tight —
the structural summary, the roadmap delta, and the ranked list with rationale. Then either invoke
`/spec` for the top pick (Step 4) or report the ranking and ask which to spec.

> Note: `docs/synthesis/` is git-tracked. If you'd rather keep synthesis local (like `docs/specs/`),
> add it to `.gitignore`.
