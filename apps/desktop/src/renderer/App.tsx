import React, { useEffect, useState, useCallback } from "react";
import { ProjectSessionTree } from "./components/project-session-tree.js";
import { SessionList } from "./components/session-list.js";
import { SessionTable } from "./components/session-table.js";
import { DetailPanel } from "./components/detail-panel.js";
import { PolicyPanel } from "./components/policy-panel.js";
import { MemoryPanel } from "./components/memory-panel.js";
import { CompactForkModal } from "./components/compact-fork-modal.js";
import { SessionRow, SessionDetail, GCEvent, Project, SERVER } from "./types.js";
import { tokens } from "./theme.js";

const POLL_MS = 5_000;
const TTL_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "All", days: 0 },
] as const;

type ViewMode = "project" | "session" | "table";
const VIEW_OPTIONS = [
  { label: "By Project", value: "project" },
  { label: "By Session", value: "session" },
  { label: "Table", value: "table" },
] as const;

export function App() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [ttlDays, setTtlDays] = useState<number>(7);
  const [view, setView] = useState<ViewMode>("table");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [gcEvents, setGcEvents] = useState<GCEvent[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [memoryProjectId, setMemoryProjectId] = useState<string | null>(null);
  const [compactForkSessionId, setCompactForkSessionId] = useState<string | null>(null);
  const [compactMode, setCompactMode] = useState<"fork" | "compact">("fork");

  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const param = ttlDays > 0 ? `?since_days=${ttlDays}` : "?since_days=0";
      const res = await fetch(`${SERVER}/sessions${param}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data: SessionRow[] = await res.json();
      setSessions(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cannot reach server at localhost:7842");
    }
  }, [ttlDays]);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const [detailRes, eventsRes] = await Promise.all([
        fetch(`${SERVER}/sessions/${id}`),
        fetch(`${SERVER}/sessions/${id}/gc-events`),
      ]);
      if (detailRes.ok) setDetail(await detailRes.json());
      if (eventsRes.ok) setGcEvents(await eventsRes.json());
    } catch {
      // non-critical
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER}/projects`);
      if (!res.ok) return;
      const data: Project[] = await res.json();
      setProjects(data);
    } catch {
      // non-critical — policy banners just won't render
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    fetchProjects();
    const t = setInterval(() => {
      fetchSessions();
      fetchProjects();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [fetchSessions, fetchProjects]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  function handleSelect(id: string) {
    setSelectedProjectId(null);
    if (id === selectedId) {
      setSelectedId(null);
      setDetail(null);
      setGcEvents([]);
    } else {
      setSelectedId(id);
    }
  }

  function handleCompact(id: string) {
    setCompactMode("compact");
    setCompactForkSessionId(id);
  }

  function handleFork(id: string) {
    setCompactMode("fork");
    setCompactForkSessionId(id);
  }

  function handleSelectProject(projectId: string) {
    setSelectedId(null);
    setDetail(null);
    setGcEvents([]);
    setMemoryProjectId(null);
    setSelectedProjectId((prev) => (prev === projectId ? null : projectId));
  }

  function handleViewMemory(projectId: string) {
    // Panels share the right-hand overlay slot — clear the others so they can't stack.
    setSelectedId(null);
    setDetail(null);
    setGcEvents([]);
    setSelectedProjectId(null);
    setMemoryProjectId((prev) => (prev === projectId ? null : projectId));
  }

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const memoryProject = projects.find((p) => p.id === memoryProjectId) ?? null;
  const compactForkSession = sessions.find((s) => s.id === compactForkSessionId) ?? null;
  const sessionCount = sessions.length;

  if (error) {
    return (
      <div style={styles.error}>
        <div style={styles.errorIcon}>⚠</div>
        <div style={styles.errorText}>{error}</div>
        <button style={styles.retryBtn} onClick={fetchSessions}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {/* Title bar */}
      <div style={styles.titleBar}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ flexShrink: 0, marginRight: 6 }}
          aria-hidden="true"
        >
          <rect width="40" height="40" rx="6" fill="#0D1117" />
          <path
            d="M12 8 L9 8 L9 32 L12 32"
            stroke="#00C9A7"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M28 8 L31 8 L31 32 L28 32"
            stroke="#00C9A7"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="20" cy="14" r="2.5" fill="#00C9A7" />
          <circle cx="15" cy="22" r="1.8" fill="#00C9A7" opacity="0.65" />
          <circle cx="25" cy="22" r="1.8" fill="#00C9A7" opacity="0.65" />
          <line x1="20" y1="14" x2="15" y2="22" stroke="#00C9A7" strokeWidth="0.8" opacity="0.5" />
          <line x1="20" y1="14" x2="25" y2="22" stroke="#00C9A7" strokeWidth="0.8" opacity="0.5" />
          <line x1="15" y1="22" x2="25" y2="22" stroke="#00C9A7" strokeWidth="0.6" opacity="0.3" />
        </svg>
        <span style={styles.titleText}>Claude OS</span>
        <span style={styles.titleMeta}>
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
        </span>

        {/* Right-aligned controls: View mode + TTL filter */}
        <div style={styles.controls}>
          <div style={styles.segGroup}>
            {VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                style={{
                  ...styles.segBtn,
                  ...(view === opt.value ? styles.segBtnActive : {}),
                }}
                onClick={() => setView(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div style={styles.segGroup}>
            {TTL_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                style={{
                  ...styles.segBtn,
                  ...(ttlDays === opt.days ? styles.segBtnActive : {}),
                }}
                onClick={() => setTtlDays(opt.days)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content — tree/table fills space, panels overlay from right */}
      <div style={styles.content}>
        {view === "table" ? (
          // SessionList (left nav) + SessionTable (detail) — the two redesigned
          // session views, mounted as the two-pane layout they were built for.
          <div style={styles.tablePane}>
            <SessionList sessions={sessions} selected={selectedId} onSelect={handleSelect} />
            <SessionTable
              sessions={sessions}
              selected={selectedId}
              onSelect={handleSelect}
              onCompact={handleCompact}
              onFork={handleFork}
            />
          </div>
        ) : (
          <ProjectSessionTree
            sessions={sessions}
            projects={projects}
            view={view}
            ttlDays={ttlDays}
            selected={selectedId}
            onSelect={handleSelect}
            onSelectProject={handleSelectProject}
            onViewMemory={handleViewMemory}
            onCompactFork={handleFork}
          />
        )}

        {selected && detail && (
          <DetailPanel
            session={selected}
            detail={detail}
            gcEvents={gcEvents}
            onClose={() => {
              setSelectedId(null);
              setDetail(null);
              setGcEvents([]);
            }}
          />
        )}

        {selectedProjectId && selectedProject && (
          <PolicyPanel
            projectId={selectedProjectId}
            projectName={selectedProject.name}
            onClose={() => setSelectedProjectId(null)}
          />
        )}

        {memoryProjectId && memoryProject && (
          <MemoryPanel
            projectId={memoryProjectId}
            projectName={memoryProject.name}
            onClose={() => setMemoryProjectId(null)}
          />
        )}

        {compactForkSessionId && compactForkSession && (
          <CompactForkModal
            sessionId={compactForkSessionId}
            sessionName={compactForkSession.name}
            model={compactForkSession.model}
            ctxPct={compactForkSession.current_ctx_pct ?? 0}
            ctxWindow={compactForkSession.ctx_window}
            mode={compactMode}
            lastCompaction={
              compactForkSessionId === selectedId ? (detail?.lastCompaction ?? null) : null
            }
            onDone={() => {
              fetchSessions();
              setCompactForkSessionId(null);
            }}
            onClose={() => setCompactForkSessionId(null)}
          />
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: tokens.void,
    userSelect: "none",
    overflow: "hidden",
    fontFamily: tokens.fontMono,
  },
  titleBar: {
    height: 44,
    display: "flex",
    alignItems: "center",
    paddingLeft: 80,
    paddingRight: tokens.sp4,
    gap: 10,
    borderBottom: `0.5px solid ${tokens.border}`,
    background: tokens.surface0,
    // @ts-ignore
    WebkitAppRegion: "drag",
    flexShrink: 0,
  },
  titleText: {
    fontSize: tokens.fsSection,
    fontWeight: 600,
    color: tokens.highlight,
    letterSpacing: "-0.02em",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
  },
  titleMeta: {
    fontSize: tokens.fsLabel,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    letterSpacing: "0.02em",
  },
  controls: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    // @ts-ignore
    WebkitAppRegion: "no-drag",
  },
  // Segmented control — used for both the View and TTL toggles
  segGroup: {
    display: "flex",
    gap: 0,
    background: tokens.void,
    border: `0.5px solid ${tokens.surface2}`,
    borderRadius: tokens.radiusSm,
    overflow: "hidden",
  },
  segBtn: {
    background: "transparent",
    border: "none",
    color: tokens.muted,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "3px 9px",
    letterSpacing: "0.04em",
  },
  segBtnActive: {
    background: tokens.surface2,
    color: tokens.highlight,
  },
  content: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  tablePane: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "row",
    overflow: "hidden",
  },
  error: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.sp3,
  },
  errorIcon: { fontSize: 32, color: "#EF4444" },
  errorText: {
    color: tokens.muted,
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
  },
  retryBtn: {
    marginTop: tokens.sp1,
    padding: "6px 16px",
    background: tokens.surface1,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    color: tokens.highlight,
    fontSize: tokens.fsData,
    cursor: "pointer",
    fontFamily: tokens.fontMono,
  },
};
