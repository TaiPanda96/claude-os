# Claude OS — A Policy-Driven Advisor for Your Agents

> You write a policy for how an agent should spend its context budget.
> Claude OS measures every session against that policy, tells you exactly what
> to do to stay efficient, and — on your approval — executes the compaction that
> turns a bloated session into durable, reusable memory.

This document is the product's spine. `README.md` is the technical tour;
`ARCHITECTURE.md` is the data flow. **This is what Claude OS *is* and, just as
importantly, what it is not.**

---

## The thesis

Every Claude session has a **context efficiency curve**. Early tokens produce
high-quality, well-grounded output; past a depth — typically 70–80% of the
window — the model attends equally to stale threads and your actual goals.
Quality inflects. Today that inflection is invisible, and the only tools you
have are blunt: clear the session, or let it rot.

Two ways to fix an invisible problem:

- **Autopilot** — silently compress context so the user never thinks about it.
  (This is the HeadRoom model: zero user agency, zero user understanding.)
- **Advisor** — make the economics visible *and prescriptive*: show what's
  happening, then tell the user the single best action to take, and do it for
  them on one click.

**Claude OS is an Advisor.** We bet that developers running agents want a hand
on the wheel — a tool that explains *why* a session is degrading and recommends
*what to do about it*, not a black box that mutates their context invisibly. The
moat is not compression. It's **measurement that earns the right to advise.**

---

## The one primitive: a Policy

Everything in Claude OS is one concept: **a policy, attached to a project.** A
policy is your declaration of how agents in this project should manage their
context economy. It answers three questions, and nothing else:

| A policy defines | The question it answers | Examples |
|---|---|---|
| **Metrics** | *What do we measure, and what counts as "degrading"?* | context utilisation %, token spend / turn, Quality Proxy, Work Efficiency, GC state |
| **Triggers** | *When should we compact?* | turn cadence (every N), context threshold (≥ X%), architectural-decision detected, outcome-resolved detected, custom semantic classifier |
| **Eviction** | *What gets written to memory, and when does it go stale?* | per-file memory schema: update mode (overwrite / append / merge), decay scope (session / project / permanent) |

> **Design note — why this is three knobs, not one blob.** Earlier the codebase
> fused "when to compact" (triggers) with "what to capture" (memory schema)
> into a single `policy` object, and manual actions silently depended on half of
> it. That conflation is the source of the product confusion. PRODUCT.md draws
> the line cleanly: **Metrics → Triggers → Eviction** are three distinct
> sections of one policy, and every action in the product maps to exactly one of
> them.

You write a policy once per project. From then on, Claude OS does three things.

---

## What Claude OS does

### 1. Tracks — agentic activity, measured against your policy

A `Stop` hook captures every turn. Claude OS computes, in real time:

- **Token spend per turn** — cache-aware (read / creation / effective input), priced.
- **Quality Proxy** — output density, self-correction markers, turn-over-turn
  repetition, distilled into a per-turn signal and a session-level degradation
  curve (peak, inflection, trend, turns-to-inflection).
- **Work Efficiency** — output value per token spent across the efficiency curve.
- **GC state** — the four-state machine your metrics roll up into:
  `Clean → Soft GC → Hard GC → Aged`.

These aren't dashboards for their own sake. Each metric exists because a policy
*trigger* can fire on it. **Measurement and policy share one vocabulary.**

### 2. Advises & Executes — policy-driven compaction

This is the heart of the Advisor. When your policy's triggers are met, Claude OS
doesn't silently act and it doesn't just color a bar red. It surfaces a single
**prescriptive recommendation**:

> *"Session past its quality inflection (turn 34, ctx 78%). Compact now —
> frees ~42% of the window, saves ~$0.18 on the next turn. The 3 oldest
> threads haven't been referenced in 20 turns."*

The recommendation **is** the action. One click runs the same
`policy-driven-compaction` the autopilot trigger would have run — there is no
second, separate "manual compact" path with different rules. Compaction reads
the policy, distils the session's turns according to the **Eviction** schema, and
writes a **policy-driven memory architecture** to disk.

Two lineage choices, both surfaced as recommendations, never as scary buttons:

- **Compact in place** — the session continues; its next start loads compact
  memory instead of raw history.
- **Compact & fork** — branch a fresh session seeded with the distilled context,
  leaving the original intact.

Both write the same memory. Forking is just *"compact, then start clean."*

### 3. Manages memory — the durable artifact

Compaction's output is a typed, inspectable **memory store** under
`~/.claude/projects/<cwd>/claude-os/memory/`, injected into every new Claude
session in that project. You can **read, export, and manage** it:

- See exactly what each compaction wrote (the loop closes: every action links to
  its artifact — *"here's what got saved"*).
- Export memory as portable files.
- Let eviction policy bound the store so retrieval stays cheap.

**Storage is free; context is expensive.** Memory lives fully on disk; only a
thin *index* is seeded into a new session, with bodies pulled just-in-time. This
is why Claude OS is **complementary to native compaction, not a competitor** —
native compaction minimizes context *within* one session under duress and throws
the result away; Claude OS minimizes what the *next* session inherits, and keeps
the result.

> **The litmus test we hold ourselves to:** a session seeded with memory must
> reach productive work in *fewer* tokens than the same session cold-started. If
> memory doesn't pay for itself, it's a preamble tax — and we measure that too.

---

## The shape of the loop

```
        ┌─────────────────────────────────────────────────────────┐
        │                     POLICY (per project)                 │
        │     Metrics  ·  Triggers  ·  Eviction (memory schema)    │
        └─────────────────────────────────────────────────────────┘
                 │                  │                    ▲
                 ▼                  ▼                    │
            ┌─────────┐      ┌───────────────┐    ┌─────────────┐
            │  TRACK  │ ───▶ │ ADVISE/EXECUTE│ ──▶│   MEMORY    │
            │ per-turn│ met? │ recommend +   │    │ read/export │
            │ metrics │      │ 1-click compact│   │  /manage    │
            └─────────┘      └───────────────┘    └─────────────┘
                                                         │
                            seeds next session ◀─────────┘
```

Track feeds Triggers. Triggers fire Advice. Advice (on approval) runs
Compaction. Compaction writes Memory. Memory seeds the next session, which Track
measures. **One policy, one loop.**

---

## What Claude OS is *not* (cutting the bloat)

- **Not a context compressor / runtime.** We do not sit in the inference path or
  re-encode tokens. We advise across the session boundary; we never intercept a
  live request. (We don't compete with native compaction — we extend it.)
- **Not a silent autopilot.** Compaction is policy-*driven* but
  user-*approved* by default. The user always sees the recommendation and the
  projected savings before anything mutates. "Auto-apply this class of
  recommendation" is an opt-in you graduate to, not the default.
- **Not a generic dashboard.** Every metric we show exists because a policy can
  act on it. If a number can't drive a recommendation or a trigger, it doesn't
  belong here.
- **Not a chat/agent framework.** We don't run your agents. We observe Claude
  Code sessions and manage their context economy.

---

## Who it's for

Developers running real, long-lived agentic coding sessions who can feel quality
degrade but can't see why, and who want a principled, inspectable way to manage
the cost and context of those sessions per project — without surrendering
control to a black box.

---

## North star

> **Make the cost and quality of agentic work legible, and turn every session
> into durable memory the next session inherits — on the user's terms, by
> policy, with a hand on the wheel.**
