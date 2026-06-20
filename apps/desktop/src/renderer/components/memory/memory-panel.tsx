import { useCallback, useEffect, useState } from "react";
import { CompactionEventDetail, MemoryArtifact, SERVER } from "../../types.js";
import { gc } from "../../theme.js";
import { memoryStyles } from "./memory-styles-config.js";

type Tab = "current" | "history";

interface MemoryPanelProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

interface MemoryFileIoDiffLines {
  type: "added" | "removed" | "same";
  text: string;
}

export function MemoryPanel({ projectId, projectName, onClose }: MemoryPanelProps) {
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
  function showMemoryFileIoDiffLines(prev: string, next: string): MemoryFileIoDiffLines[] {
    const prevLines = prev.split("\n");
    const nextLines = next.split("\n");
    const result: MemoryFileIoDiffLines[] = [];
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
    <div style={memoryStyles.panel}>
      {/* Header */}
      <div style={memoryStyles.header}>
        <div style={memoryStyles.headerLeft}>
          <span style={memoryStyles.headerIcon}>◈</span>
          <div>
            <div style={memoryStyles.headerTitle}>Memory</div>
            <div style={memoryStyles.headerSub}>{projectName}</div>
          </div>
        </div>
        <button style={memoryStyles.closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div style={memoryStyles.tabRow}>
        {(["current", "history"] as Tab[]).map((t) => (
          <button
            key={t}
            style={{ ...memoryStyles.tab, ...(tab === t ? memoryStyles.tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {t === "current" ? `Current state` : `Compaction history`}
            {t === "current" && artifacts.length > 0 && (
              <span style={memoryStyles.tabBadge}>{artifacts.length}</span>
            )}
            {t === "history" && events.length > 0 && (
              <span style={memoryStyles.tabBadge}>{events.length}</span>
            )}
          </button>
        ))}
        <button style={memoryStyles.refreshBtn} onClick={fetchData} title="Refresh">
          ↺
        </button>
      </div>

      <div style={memoryStyles.body}>
        {loading && <div style={memoryStyles.empty}>Loading…</div>}

        {/* ── Current state tab ── */}
        {!loading && tab === "current" && (
          <>
            {artifacts.length === 0 ? (
              <div style={memoryStyles.empty}>
                No memory files yet — run a compaction to generate artifacts.
              </div>
            ) : (
              artifacts.map((f) => {
                const isExpanded = expandedFile === f.filename;
                return (
                  <div key={f.filename} style={memoryStyles.fileCard}>
                    <button
                      style={memoryStyles.fileCardHeader}
                      onClick={() => setExpandedFile(isExpanded ? null : f.filename)}
                    >
                      <span style={memoryStyles.fileIcon}>◈</span>
                      <span style={memoryStyles.fileName}>{f.filename}</span>
                      <span style={memoryStyles.fileMeta}>
                        {fmtBytes(f.bytes)} · {relTime(f.modified_at)}
                      </span>
                      <span style={memoryStyles.chevron}>{isExpanded ? "▴" : "▾"}</span>
                    </button>
                    {isExpanded && <pre style={memoryStyles.fileContent}>{f.content}</pre>}
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
              <div style={memoryStyles.empty}>No completed compactions yet.</div>
            ) : (
              <div style={memoryStyles.historyLayout}>
                {/* Event timeline sidebar */}
                <div style={memoryStyles.timeline}>
                  {events.map((e, i) => (
                    <button
                      key={e.id}
                      style={{
                        ...memoryStyles.timelineItem,
                        ...(i === selectedEventIdx ? memoryStyles.timelineItemActive : {}),
                      }}
                      onClick={() => {
                        setSelectedEventIdx(i);
                        setExpandedEventFile(null);
                      }}
                    >
                      <span style={memoryStyles.timelineDot} />
                      <div style={memoryStyles.timelineText}>
                        <div style={memoryStyles.timelineDate}>
                          {e.completed_at ? fmtDate(e.completed_at) : "—"}
                        </div>
                        <div style={memoryStyles.timelineMeta}>
                          {e.files_written.length} file{e.files_written.length !== 1 ? "s" : ""}
                          {" · "}~{fmtTokens(e.tokens_at_trigger)} →{" "}
                          {fmtTokens(e.output_size_tokens)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Diff view */}
                <div style={memoryStyles.diffPane}>
                  {selectedEvent &&
                    selectedEvent.files_written.map((f) => {
                      const prevFile = prevEvent?.files_written.find(
                        (p) => p.filename === f.filename,
                      );
                      const isExpanded = expandedEventFile === f.filename;
                      const diff = prevFile
                        ? showMemoryFileIoDiffLines(prevFile.content, f.content)
                        : null;

                      return (
                        <div key={f.filename} style={memoryStyles.fileCard}>
                          <button
                            style={memoryStyles.fileCardHeader}
                            onClick={() => setExpandedEventFile(isExpanded ? null : f.filename)}
                          >
                            <span style={memoryStyles.fileIcon}>◈</span>
                            <span style={memoryStyles.fileName}>{f.filename}</span>
                            <span style={memoryStyles.fileMeta}>{fmtBytes(f.bytes_written)}</span>
                            {!prevFile && (
                              <span
                                style={{
                                  ...memoryStyles.diffBadge,
                                  background: gc.clean.bg,
                                  color: gc.clean.text,
                                  border: `1px solid ${gc.clean.border}`,
                                }}
                              >
                                new
                              </span>
                            )}
                            <span style={memoryStyles.chevron}>{isExpanded ? "▴" : "▾"}</span>
                          </button>
                          {isExpanded && (
                            <div style={memoryStyles.diffBody}>
                              {diff ? (
                                diff.map((line, li) => (
                                  <div
                                    key={li}
                                    style={{
                                      ...memoryStyles.diffLine,
                                      ...(line.type === "added" ? memoryStyles.diffAdded : {}),
                                      ...(line.type === "removed" ? memoryStyles.diffRemoved : {}),
                                    }}
                                  >
                                    <span style={memoryStyles.diffGutter}>
                                      {line.type === "added"
                                        ? "+"
                                        : line.type === "removed"
                                          ? "−"
                                          : " "}
                                    </span>
                                    <span>{line.text}</span>
                                  </div>
                                ))
                              ) : (
                                <pre style={memoryStyles.fileContent}>{f.content}</pre>
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

// ----------- Formatting helpers --------------------
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
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
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
