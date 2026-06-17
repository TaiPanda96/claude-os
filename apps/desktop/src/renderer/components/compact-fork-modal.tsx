import React, { useEffect, useState } from "react";
import { CompactionEventSummary, MODEL_PRICING, SERVER } from "../types.js";
import { tokens, gc } from "../theme.js";

type ModalState = "preview" | "compacting" | "done" | "error";

interface FileResult {
  filename: string;
  bytes_written: number;
  content: string;
}

interface CompletedEvent {
  files_written: FileResult[];
  output_size_tokens: number;
  tokens_at_trigger: number;
}

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
  const [completedEvent, setCompletedEvent] = useState<CompletedEvent | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Savings estimate
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
      const compactRes = await fetch(`${SERVER}/sessions/${sessionId}/compact`, {
        method: "POST",
      });
      if (!compactRes.ok) throw new Error(`Compact failed: ${compactRes.status}`);

      // Poll until complete, capturing the finished event for the file preview
      let finished: CompletedEvent | null = null;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await delay(1500);
        const eventsRes = await fetch(`${SERVER}/sessions/${sessionId}/compaction-events`);
        if (eventsRes.ok) {
          const events = (await eventsRes.json()) as Array<{
            status: string;
            files_written: FileResult[];
            output_size_tokens: number;
            tokens_at_trigger: number;
            error?: string;
          }>;
          const latest = events[0];
          if (latest?.status === "completed") {
            finished = {
              files_written: latest.files_written,
              output_size_tokens: latest.output_size_tokens,
              tokens_at_trigger: latest.tokens_at_trigger,
            };
            break;
          }
          if (latest?.status === "failed") {
            throw new Error(latest.error ?? "Compaction failed");
          }
        }
      }
      if (!finished) throw new Error("Compaction timed out after 120s");

      // Create fork record
      const forkRes = await fetch(`${SERVER}/sessions/${sessionId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!forkRes.ok) throw new Error(`Fork failed: ${forkRes.status}`);
      const { id } = (await forkRes.json()) as { id: string };

      setCompletedEvent(finished);
      setForkId(id);
      setState("done");
      onDone(id);

      // OS notification — fires even if the window is behind other apps
      if (typeof Notification !== "undefined" && Notification.permission !== "denied") {
        const grant =
          Notification.permission === "granted"
            ? "granted"
            : await Notification.requestPermission();
        if (grant === "granted") {
          new Notification("⑂ Fork ready — Claude OS", {
            body: `${finished.files_written.length} memory file${finished.files_written.length !== 1 ? "s" : ""} written. Open a new Claude session in this project to continue.`,
            silent: false,
          });
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  function handleCopyPath() {
    const path = `~/.claude/projects/<cwd>/claude-os/memory/`;
    void navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      style={styles.backdrop}
      onClick={(e) =>
        e.target === e.currentTarget && state !== "compacting" && onClose()
      }
    >
      <div style={{ ...styles.modal, ...(state === "done" ? styles.modalWide : {}) }}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerGlyph}>⑂</span>
          <span style={styles.headerTitle}>Compact &amp; Fork</span>
          {state !== "compacting" && (
            <button style={styles.closeBtn} onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {/* ── Preview ── */}
        {state === "preview" && (
          <>
            <div style={styles.body}>
              <div style={styles.sessionLabel}>{sessionName ?? sessionId.slice(0, 8)}</div>
              <div style={styles.ctxLine}>
                Current context:{" "}
                <span style={styles.highlight}>{(ctxPct * 100).toFixed(1)}%</span>
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

              <div style={styles.hint}>
                {lastCompaction && lastCompaction.output_size_tokens > 0
                  ? `Ratio from last compaction (${(compressionRatio * 100).toFixed(0)}%)`
                  : "Using 15% heuristic — no prior compaction for this session"}
              </div>
            </div>

            <div style={styles.footer}>
              <button style={styles.cancelBtn} onClick={onClose}>
                Cancel
              </button>
              <button style={styles.confirmBtn} onClick={handleConfirm}>
                ⑂ Compact &amp; Fork
              </button>
            </div>
          </>
        )}

        {/* ── Compacting ── */}
        {state === "compacting" && (
          <div style={styles.body}>
            <div style={styles.spinnerRow}>
              <span style={styles.spinner}>⟳</span>
              <span style={styles.statusText}>Compacting…</span>
            </div>
            <div style={styles.hint}>Writing memory files. This may take up to a minute.</div>
          </div>
        )}

        {/* ── Done ── */}
        {state === "done" && forkId && completedEvent && (
          <>
            <div style={styles.body}>
              {/* Header row */}
              <div style={styles.doneHeaderRow}>
                <span style={styles.doneCheck}>✓</span>
                <div>
                  <div style={styles.doneTitle}>Fork {forkId.slice(0, 8)} ready</div>
                  <div style={styles.doneMeta}>
                    {completedEvent.files_written.length} file
                    {completedEvent.files_written.length !== 1 ? "s" : ""} written
                    {" · "}
                    {fmtBytes(completedEvent.files_written.reduce((s, f) => s + f.bytes_written, 0))}
                    {" · "}
                    <span style={{ color: gc.clean.text }}>
                      ~{fmtTokens(completedEvent.output_size_tokens)} tokens
                    </span>
                  </div>
                </div>
              </div>

              <div style={styles.divider} />

              {/* File list */}
              <div style={styles.fileListLabel}>Memory files written</div>
              <div style={styles.fileList}>
                {completedEvent.files_written.map((f) => {
                  const isExpanded = expandedFile === f.filename;
                  return (
                    <div key={f.filename} style={styles.fileCard}>
                      <button
                        style={styles.fileCardHeader}
                        onClick={() =>
                          setExpandedFile(isExpanded ? null : f.filename)
                        }
                      >
                        <span style={styles.fileIcon}>◈</span>
                        <span style={styles.fileName}>{f.filename}</span>
                        <span style={styles.fileSize}>{fmtBytes(f.bytes_written)}</span>
                        <span style={styles.fileChevron}>{isExpanded ? "▴" : "▾"}</span>
                      </button>
                      {isExpanded && (
                        <div style={styles.filePreview}>
                          {f.content || <span style={{ opacity: 0.5 }}>(empty)</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={styles.hint}>
                Open a new Claude session in this project to start with a clean context.
              </div>
            </div>

            <div style={styles.footer}>
              <button style={styles.copyPathBtn} onClick={handleCopyPath}>
                {copied ? "✓ Copied" : "Copy memory path"}
              </button>
              <button style={styles.confirmBtn} onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {/* ── Error ── */}
        {state === "error" && (
          <>
            <div style={styles.body}>
              <div style={{ ...styles.doneCheck, color: gc.hard_gc.text, fontSize: 28 }}>✕</div>
              <div style={{ ...styles.doneTitle, color: gc.hard_gc.text, marginTop: tokens.sp2 }}>
                Failed
              </div>
              <div style={styles.errorMsg}>{errorMsg}</div>
            </div>
            <div style={styles.footer}>
              <button style={styles.cancelBtn} onClick={onClose}>
                Cancel
              </button>
              <button
                style={styles.confirmBtn}
                onClick={() => {
                  setState("preview");
                  setErrorMsg(null);
                }}
              >
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

function fmtBytes(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(1)}kb`;
  return `${n}b`;
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
  modalWide: {
    width: 420,
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
    padding: tokens.sp4,
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
    margin: `${tokens.sp3}px 0`,
  },
  savingsTitle: {
    fontSize: tokens.fsLabel,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: tokens.sp2,
  },
  savingsGrid: {
    display: "flex",
    flexDirection: "column" as const,
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
    marginTop: tokens.sp2,
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
    display: "inline-block",
  },
  statusText: {
    fontSize: tokens.fsBody,
    color: tokens.text,
    fontFamily: tokens.fontMono,
  },
  // Done state
  doneHeaderRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.sp3,
    marginBottom: 0,
  },
  doneCheck: {
    fontSize: 22,
    color: gc.clean.text,
    flexShrink: 0,
    lineHeight: 1.2,
  },
  doneTitle: {
    fontSize: tokens.fsBody,
    fontWeight: 600,
    color: tokens.highlight,
    fontFamily: tokens.fontMono,
  },
  doneMeta: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    marginTop: 2,
    fontVariantNumeric: "tabular-nums",
  },
  fileListLabel: {
    fontSize: tokens.fsLabel,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: tokens.sp2,
  },
  fileList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: tokens.sp1,
    marginBottom: tokens.sp2,
  },
  fileCard: {
    background: tokens.surface2,
    borderRadius: tokens.radiusSm,
    overflow: "hidden",
    border: `0.5px solid ${tokens.border}`,
  },
  fileCardHeader: {
    display: "flex",
    alignItems: "center",
    gap: tokens.sp2,
    padding: `${tokens.sp2}px ${tokens.sp3}px`,
    background: "transparent",
    border: "none",
    width: "100%",
    cursor: "pointer",
    textAlign: "left" as const,
  },
  fileIcon: {
    fontSize: tokens.fsMicro,
    color: gc.soft_gc.text,
    flexShrink: 0,
  },
  fileName: {
    fontSize: tokens.fsData,
    color: tokens.highlight,
    fontFamily: tokens.fontMono,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  fileSize: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  fileChevron: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    flexShrink: 0,
    marginLeft: tokens.sp1,
  },
  filePreview: {
    padding: `${tokens.sp2}px ${tokens.sp3}px`,
    borderTop: `0.5px solid ${tokens.border}`,
    fontSize: tokens.fsMicro,
    color: tokens.text,
    fontFamily: tokens.fontMono,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    maxHeight: 120,
    overflowY: "auto" as const,
  },
  truncHint: {
    color: tokens.muted,
    fontStyle: "italic",
  },
  errorMsg: {
    fontSize: tokens.fsData,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    lineHeight: 1.6,
    marginTop: tokens.sp2,
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
  copyPathBtn: {
    background: "transparent",
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.muted,
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "5px 14px",
    marginRight: "auto",
  },
};
