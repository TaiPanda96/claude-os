import React, { useEffect, useState } from "react";
import { CompactionEventSummary, MODEL_PRICING, SERVER } from "../types.js";
import { tokens, gc } from "../theme.js";

type ModalState = "preview" | "compacting" | "done" | "error";

interface Props {
  sessionId: string;
  sessionName: string | null;
  model: string;
  ctxPct: number;
  ctxWindow: number;
  lastCompaction: CompactionEventSummary | null;
  onDone: (forkId: string) => void;
  onClose: () => void;
}

export function CompactForkModal({
  sessionId,
  sessionName,
  model,
  ctxPct,
  ctxWindow,
  lastCompaction,
  onDone,
  onClose,
}: Props) {
  const [state, setState] = useState<ModalState>("preview");
  const [forkId, setForkId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compute savings estimate
  const currentTokens = Math.round(ctxPct * ctxWindow);
  const compressionRatio =
    lastCompaction && lastCompaction.output_size_tokens > 0
      ? lastCompaction.output_size_tokens / lastCompaction.tokens_at_trigger
      : 0.15;
  const estimatedSummaryTokens = Math.round(currentTokens * compressionRatio);
  const tokensSaved = Math.max(0, currentTokens - estimatedSummaryTokens);
  const pctFreed = tokensSaved / ctxWindow;
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["claude-sonnet-4-6"]!;
  const costSaved = (tokensSaved / 1_000_000) * pricing.inputPerM;

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && state !== "compacting") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, onClose]);

  async function handleConfirm() {
    setState("compacting");
    try {
      // Trigger compaction
      const compactRes = await fetch(`${SERVER}/sessions/${sessionId}/compact`, {
        method: "POST",
      });
      if (!compactRes.ok) throw new Error(`Compact failed: ${compactRes.status}`);

      // Poll for completion (max 120s)
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await delay(1500);
        const eventsRes = await fetch(`${SERVER}/sessions/${sessionId}/compaction-events`);
        if (eventsRes.ok) {
          const events = (await eventsRes.json()) as Array<{ status: string }>;
          const latest = events[0];
          if (latest?.status === "completed") break;
          if (latest?.status === "failed") throw new Error("Compaction failed");
        }
      }

      // Create fork record
      const forkRes = await fetch(`${SERVER}/sessions/${sessionId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!forkRes.ok) throw new Error(`Fork failed: ${forkRes.status}`);
      const { id } = (await forkRes.json()) as { id: string };
      setForkId(id);
      setState("done");
      onDone(id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  return (
    <div style={styles.backdrop} onClick={(e) => e.target === e.currentTarget && state !== "compacting" && onClose()}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerGlyph}>⑂</span>
          <span style={styles.headerTitle}>Compact &amp; Fork</span>
          {state !== "compacting" && (
            <button style={styles.closeBtn} onClick={onClose}>✕</button>
          )}
        </div>

        {state === "preview" && (
          <>
            <div style={styles.body}>
              <div style={styles.sessionLabel}>
                {sessionName ?? sessionId.slice(0, 8)}
              </div>
              <div style={styles.ctxLine}>
                Current context: <span style={styles.highlight}>{(ctxPct * 100).toFixed(1)}%</span>
                {" · "}
                <span style={styles.highlight}>{fmtTokens(currentTokens)}</span> tokens
              </div>

              <div style={styles.divider} />

              <div style={styles.savingsTitle}>Compacting now frees:</div>
              <div style={styles.savingsGrid}>
                <div style={styles.savingsRow}>
                  <span style={styles.savingsLabel}>Tokens freed</span>
                  <span style={styles.savingsValue}>{fmtTokens(tokensSaved)}</span>
                </div>
                <div style={styles.savingsRow}>
                  <span style={styles.savingsLabel}>Context freed</span>
                  <span style={styles.savingsValue}>{(pctFreed * 100).toFixed(0)}%</span>
                </div>
                <div style={styles.savingsRow}>
                  <span style={styles.savingsLabel}>Future input cost</span>
                  <span style={{ ...styles.savingsValue, color: gc.clean.text }}>
                    ~${costSaved.toFixed(3)}
                  </span>
                </div>
              </div>

              {lastCompaction && (
                <div style={styles.hint}>
                  Ratio from last compaction ({lastCompaction.output_size_tokens > 0
                    ? `${(compressionRatio * 100).toFixed(0)}%`
                    : "15% heuristic"})
                </div>
              )}
              {!lastCompaction && (
                <div style={styles.hint}>Using 15% heuristic — no prior compaction for this session</div>
              )}
            </div>

            <div style={styles.footer}>
              <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button style={styles.confirmBtn} onClick={handleConfirm}>
                ⑂ Compact &amp; Fork
              </button>
            </div>
          </>
        )}

        {state === "compacting" && (
          <div style={styles.body}>
            <div style={styles.spinnerRow}>
              <span style={styles.spinner}>⟳</span>
              <span style={styles.statusText}>Compacting…</span>
            </div>
            <div style={styles.hint}>This may take up to a minute. Do not close the window.</div>
          </div>
        )}

        {state === "done" && forkId && (
          <>
            <div style={styles.body}>
              <div style={styles.doneIcon}>✓</div>
              <div style={styles.doneTitle}>Fork {forkId.slice(0, 8)} ready</div>
              <div style={styles.doneDesc}>
                Open a new Claude session in this project directory. Memory files are at{" "}
                <span style={styles.code}>~/.claude/projects/&lt;cwd&gt;/claude-os/memory/</span>
              </div>
            </div>
            <div style={styles.footer}>
              <button style={styles.confirmBtn} onClick={onClose}>Done</button>
            </div>
          </>
        )}

        {state === "error" && (
          <>
            <div style={styles.body}>
              <div style={{ ...styles.doneIcon, color: gc.hard_gc.text }}>✕</div>
              <div style={{ ...styles.doneTitle, color: gc.hard_gc.text }}>Failed</div>
              <div style={styles.doneDesc}>{errorMsg}</div>
            </div>
            <div style={styles.footer}>
              <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button style={styles.confirmBtn} onClick={() => { setState("preview"); setErrorMsg(null); }}>
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: tokens.surface1,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusLg,
    width: 340,
    overflow: "hidden",
    boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: tokens.sp2,
    padding: `${tokens.sp3}px ${tokens.sp4}px`,
    borderBottom: `0.5px solid ${tokens.border}`,
    background: tokens.surface0,
  },
  headerGlyph: {
    fontSize: tokens.fsSection,
    color: gc.soft_gc.text,
    fontFamily: tokens.fontMono,
  },
  headerTitle: {
    fontSize: tokens.fsBody,
    fontWeight: 600,
    color: tokens.highlight,
    fontFamily: tokens.fontMono,
    flex: 1,
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: tokens.muted,
    cursor: "pointer",
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
    padding: 0,
    lineHeight: 1,
  },
  body: {
    padding: `${tokens.sp4}px`,
  },
  sessionLabel: {
    fontSize: tokens.fsLabel,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    marginBottom: tokens.sp1,
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  ctxLine: {
    fontSize: tokens.fsBody,
    color: tokens.text,
    fontFamily: tokens.fontMono,
    marginBottom: tokens.sp3,
  },
  highlight: {
    color: tokens.highlight,
    fontWeight: 600,
  },
  divider: {
    height: "0.5px",
    background: tokens.border,
    marginBottom: tokens.sp3,
  },
  savingsTitle: {
    fontSize: tokens.fsLabel,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    marginBottom: tokens.sp2,
  },
  savingsGrid: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.sp1,
    marginBottom: tokens.sp3,
  },
  savingsRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  savingsLabel: {
    fontSize: tokens.fsData,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
  },
  savingsValue: {
    fontSize: tokens.fsData,
    color: tokens.highlight,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
  },
  hint: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    lineHeight: 1.5,
  },
  spinnerRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.sp3,
    marginBottom: tokens.sp3,
  },
  spinner: {
    fontSize: 24,
    color: gc.soft_gc.text,
    animation: "spin 1s linear infinite",
    display: "inline-block",
  },
  statusText: {
    fontSize: tokens.fsBody,
    color: tokens.text,
    fontFamily: tokens.fontMono,
  },
  doneIcon: {
    fontSize: 28,
    color: gc.clean.text,
    marginBottom: tokens.sp2,
    textAlign: "center",
  },
  doneTitle: {
    fontSize: tokens.fsBody,
    fontWeight: 600,
    color: tokens.highlight,
    fontFamily: tokens.fontMono,
    marginBottom: tokens.sp2,
    textAlign: "center",
  },
  doneDesc: {
    fontSize: tokens.fsData,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    lineHeight: 1.6,
    textAlign: "center",
  },
  code: {
    background: tokens.surface2,
    borderRadius: tokens.radiusXs,
    padding: "1px 4px",
    color: tokens.text,
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: tokens.sp2,
    padding: `${tokens.sp3}px ${tokens.sp4}px`,
    borderTop: `0.5px solid ${tokens.border}`,
    background: tokens.surface0,
  },
  cancelBtn: {
    background: "transparent",
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.muted,
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "5px 14px",
  },
  confirmBtn: {
    background: gc.soft_gc.bg,
    border: `1px solid ${gc.soft_gc.border}`,
    borderRadius: tokens.radiusSm,
    color: gc.soft_gc.text,
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "5px 14px",
    fontWeight: 600,
  },
};
