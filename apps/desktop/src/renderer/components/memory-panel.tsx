import React, { useCallback, useEffect, useState } from "react";
import { CompactionEventDetail, MemoryArtifact, SERVER } from "../types.js";
import { tokens, gc } from "../theme.js";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

type Tab = "current" | "history";

export function MemoryPanel({ projectId, projectName, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("current");
  const [artifacts, setArtifacts] = useState<MemoryArtifact[]>([]);
  const [events, setEvents] = useState<CompactionEventDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [selectedEventIdx, setSelectedEventIdx] = useState<number>(0);
  const [expandedEventFile, setExpandedEventFile] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [memRes, eventsRes] = await Promise.all([
        fetch(`${SERVER}/projects/${projectId}/memory`),
        fetch(`${SERVER}/projects/${projectId}/compaction-events`),
      ]);
      if (memRes.ok) {
        const { files } = (await memRes.json()) as { files: MemoryArtifact[] };
        setArtifacts(files);
      }
      if (eventsRes.ok) {
        const data = (await eventsRes.json()) as CompactionEventDetail[];
        setEvents(data.filter((e) => e.status === "completed"));
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Escape closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Diff two strings line-by-line — returns annotated lines
  function diffLines(prev: string, next: string): DiffLine[] {
    const prevLines = prev.split("\n");
    const nextLines = next.split("\n");
    const result: DiffLine[] = [];
    const maxLen = Math.max(prevLines.length, nextLines.length);
    // Naive sequential diff — good enough for memory files which are structured docs
    const prevSet = new Set(prevLines);
    const nextSet = new Set(nextLines);
    for (const line of nextLines) {
      if (!prevSet.has(line)) result.push({ type: "added", text: line });
      else result.push({ type: "same", text: line });
    }
    for (const line of prevLines) {
      if (!nextSet.has(line)) result.push({ type: "removed", text: line });
    }
    void maxLen; // used for length ref only
    return result;
  }

  const selectedEvent = events[selectedEventIdx] ?? null;
  const prevEvent = selectedEventIdx < events.length - 1 ? events[selectedEventIdx + 1] : null;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.headerIcon}>◈</span>
          <div>
            <div style={styles.headerTitle}>Memory</div>
            <div style={styles.headerSub}>{projectName}</div>
          </div>
        </div>
        <button style={styles.closeBtn} onClick={onClose}>✕</button>
      </div>

      {/* Tabs */}
      <div style={styles.tabRow}>
        {(["current", "history"] as Tab[]).map((t) => (
          <button
            key={t}
            style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {t === "current" ? `Current state` : `Compaction history`}
            {t === "current" && artifacts.length > 0 && (
              <span style={styles.tabBadge}>{artifacts.length}</span>
            )}
            {t === "history" && events.length > 0 && (
              <span style={styles.tabBadge}>{events.length}</span>
            )}
          </button>
        ))}
        <button style={styles.refreshBtn} onClick={fetchData} title="Refresh">↺</button>
      </div>

      <div style={styles.body}>
        {loading && <div style={styles.empty}>Loading…</div>}

        {/* ── Current state tab ── */}
        {!loading && tab === "current" && (
          <>
            {artifacts.length === 0 ? (
              <div style={styles.empty}>
                No memory files yet — run a compaction to generate artifacts.
              </div>
            ) : (
              artifacts.map((f) => {
                const isExpanded = expandedFile === f.filename;
                return (
                  <div key={f.filename} style={styles.fileCard}>
                    <button
                      style={styles.fileCardHeader}
                      onClick={() => setExpandedFile(isExpanded ? null : f.filename)}
                    >
                      <span style={styles.fileIcon}>◈</span>
                      <span style={styles.fileName}>{f.filename}</span>
                      <span style={styles.fileMeta}>
                        {fmtBytes(f.bytes)} · {relTime(f.modified_at)}
                      </span>
                      <span style={styles.chevron}>{isExpanded ? "▴" : "▾"}</span>
                    </button>
                    {isExpanded && (
                      <pre style={styles.fileContent}>{f.content}</pre>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ── History tab ── */}
        {!loading && tab === "history" && (
          <>
            {events.length === 0 ? (
              <div style={styles.empty}>No completed compactions yet.</div>
            ) : (
              <div style={styles.historyLayout}>
                {/* Event timeline sidebar */}
                <div style={styles.timeline}>
                  {events.map((e, i) => (
                    <button
                      key={e.id}
                      style={{
                        ...styles.timelineItem,
                        ...(i === selectedEventIdx ? styles.timelineItemActive : {}),
                      }}
                      onClick={() => {
                        setSelectedEventIdx(i);
                        setExpandedEventFile(null);
                      }}
                    >
                      <span style={styles.timelineDot} />
                      <div style={styles.timelineText}>
                        <div style={styles.timelineDate}>
                          {e.completed_at ? fmtDate(e.completed_at) : "—"}
                        </div>
                        <div style={styles.timelineMeta}>
                          {e.files_written.length} file{e.files_written.length !== 1 ? "s" : ""}
                          {" · "}~{fmtTokens(e.tokens_at_trigger)} → {fmtTokens(e.output_size_tokens)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Diff view */}
                <div style={styles.diffPane}>
                  {selectedEvent && selectedEvent.files_written.map((f) => {
                    const prevFile = prevEvent?.files_written.find(
                      (p) => p.filename === f.filename,
                    );
                    const isExpanded = expandedEventFile === f.filename;
                    const diff = prevFile ? diffLines(prevFile.content, f.content) : null;

                    return (
                      <div key={f.filename} style={styles.fileCard}>
                        <button
                          style={styles.fileCardHeader}
                          onClick={() =>
                            setExpandedEventFile(isExpanded ? null : f.filename)
                          }
                        >
                          <span style={styles.fileIcon}>◈</span>
                          <span style={styles.fileName}>{f.filename}</span>
                          <span style={styles.fileMeta}>{fmtBytes(f.bytes_written)}</span>
                          {!prevFile && (
                            <span style={{ ...styles.diffBadge, background: gc.clean.bg, color: gc.clean.text, border: `1px solid ${gc.clean.border}` }}>
                              new
                            </span>
                          )}
                          <span style={styles.chevron}>{isExpanded ? "▴" : "▾"}</span>
                        </button>
                        {isExpanded && (
                          <div style={styles.diffBody}>
                            {diff ? (
                              diff.map((line, li) => (
                                <div
                                  key={li}
                                  style={{
                                    ...styles.diffLine,
                                    ...(line.type === "added" ? styles.diffAdded : {}),
                                    ...(line.type === "removed" ? styles.diffRemoved : {}),
                                  }}
                                >
                                  <span style={styles.diffGutter}>
                                    {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
                                  </span>
                                  <span>{line.text}</span>
                                </div>
                              ))
                            ) : (
                              <pre style={styles.fileContent}>{f.content}</pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface DiffLine {
  type: "added" | "removed" | "same";
  text: string;
}

function fmtBytes(n: number): string {
  if (n >= 1024) return `${(n / 1024).toFixed(1)}kb`;
  return `${n}b`;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 520,
    background: tokens.surface0,
    borderLeft: `0.5px solid ${tokens.border}`,
    display: "flex",
    flexDirection: "column",
    zIndex: 10,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${tokens.sp3}px ${tokens.sp4}px`,
    borderBottom: `0.5px solid ${tokens.border}`,
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: tokens.sp3,
  },
  headerIcon: {
    fontSize: 20,
    color: gc.soft_gc.text,
    fontFamily: tokens.fontMono,
  },
  headerTitle: {
    fontSize: tokens.fsBody,
    fontWeight: 600,
    color: tokens.highlight,
    fontFamily: tokens.fontMono,
  },
  headerSub: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: tokens.muted,
    cursor: "pointer",
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
    padding: 0,
  },
  tabRow: {
    display: "flex",
    alignItems: "center",
    borderBottom: `0.5px solid ${tokens.border}`,
    flexShrink: 0,
  },
  tab: {
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    color: tokens.muted,
    cursor: "pointer",
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    padding: `${tokens.sp2}px ${tokens.sp4}px`,
    display: "flex",
    alignItems: "center",
    gap: tokens.sp1,
  },
  tabActive: {
    color: tokens.highlight,
    borderBottomColor: gc.soft_gc.text,
  },
  tabBadge: {
    background: tokens.surface2,
    borderRadius: tokens.radiusPill,
    color: tokens.muted,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    padding: "1px 5px",
  },
  refreshBtn: {
    marginLeft: "auto",
    marginRight: tokens.sp3,
    background: "transparent",
    border: "none",
    color: tokens.muted,
    cursor: "pointer",
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: tokens.sp3,
  },
  empty: {
    padding: `${tokens.sp10}px ${tokens.sp4}px`,
    textAlign: "center",
    color: tokens.muted,
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
  },
  fileCard: {
    background: tokens.surface1,
    border: `0.5px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    marginBottom: tokens.sp2,
    overflow: "hidden",
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
    textAlign: "left",
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
    whiteSpace: "nowrap",
  },
  fileMeta: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  chevron: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    flexShrink: 0,
    marginLeft: tokens.sp1,
  },
  fileContent: {
    margin: 0,
    padding: `${tokens.sp2}px ${tokens.sp3}px`,
    borderTop: `0.5px solid ${tokens.border}`,
    fontSize: tokens.fsMicro,
    color: tokens.text,
    fontFamily: tokens.fontMono,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowY: "auto",
    maxHeight: 400,
    background: tokens.surface2,
  },
  // History layout
  historyLayout: {
    display: "flex",
    gap: tokens.sp3,
    height: "100%",
    minHeight: 0,
  },
  timeline: {
    width: 148,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  timelineItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.sp2,
    padding: `${tokens.sp2}px ${tokens.sp2}px`,
    background: "transparent",
    border: `0.5px solid transparent`,
    borderRadius: tokens.radiusSm,
    cursor: "pointer",
    textAlign: "left",
  },
  timelineItemActive: {
    background: tokens.surface1,
    border: `0.5px solid ${tokens.border}`,
  },
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: gc.soft_gc.dot,
    flexShrink: 0,
    marginTop: 4,
  },
  timelineText: {
    flex: 1,
    minWidth: 0,
  },
  timelineDate: {
    fontSize: tokens.fsMicro,
    color: tokens.text,
    fontFamily: tokens.fontMono,
    lineHeight: 1.4,
  },
  timelineMeta: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.4,
  },
  diffPane: {
    flex: 1,
    minWidth: 0,
  },
  diffBadge: {
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    borderRadius: tokens.radiusPill,
    padding: "1px 5px",
    flexShrink: 0,
  },
  diffBody: {
    borderTop: `0.5px solid ${tokens.border}`,
    maxHeight: 320,
    overflowY: "auto",
    background: tokens.surface2,
  },
  diffLine: {
    display: "flex",
    gap: tokens.sp2,
    padding: "1px 0",
    fontFamily: tokens.fontMono,
    fontSize: tokens.fsMicro,
    lineHeight: 1.6,
  },
  diffAdded: {
    background: `${gc.clean.bg}`,
    color: gc.clean.text,
  },
  diffRemoved: {
    background: `${gc.hard_gc.bg}`,
    color: gc.hard_gc.text,
    textDecoration: "line-through",
    opacity: 0.7,
  },
  diffGutter: {
    width: 16,
    flexShrink: 0,
    textAlign: "right",
    color: tokens.muted,
    userSelect: "none",
    paddingRight: tokens.sp1,
  },
};
