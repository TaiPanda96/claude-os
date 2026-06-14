import React, { useEffect, useState, useCallback } from "react";
import { ProjectSessionTree } from "./components/project-session-tree.js";
import { DetailPanel } from "./components/detail-panel.js";
import { PolicyPanel } from "./components/policy-panel.js";
import { SessionRow, SessionDetail, GCEvent, Project, SERVER } from "./types.js";
import { tokens } from "./theme.js";

const POLL_MS = 5_000;
const TTL_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "All", days: 0 },
] as const;

export function App() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [ttlDays, setTtlDays] = useState<number>(7);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [gcEvents, setGcEvents] = useState<GCEvent[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

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

  const fetchProject = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${SERVER}/projects`);
      if (!res.ok) return;
      const projects: Project[] = await res.json();
      const found = projects.find((p) => p.id === id) ?? null;
      setSelectedProject(found);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const t = setInterval(fetchSessions, POLL_MS);
    return () => clearInterval(t);
  }, [fetchSessions]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  useEffect(() => {
    if (selectedProjectId) fetchProject(selectedProjectId);
    else setSelectedProject(null);
  }, [selectedProjectId, fetchProject]);

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

  function handleSelectProject(projectId: string) {
    setSelectedId(null);
    setDetail(null);
    setGcEvents([]);
    setSelectedProjectId((prev) => (prev === projectId ? null : projectId));
  }

  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const sessionCount = sessions.length;

  if (error) {
    return (
      <div style={styles.error}>
        <div style={styles.errorIcon}>⚠</div>
        <div style={styles.errorText}>{error}</div>
        <button style={styles.retryBtn} onClick={fetchSessions}>Retry</button>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {/* Title bar */}
      <div style={styles.titleBar}>
        <svg
          width="16" height="16" viewBox="0 0 40 40" fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ flexShrink: 0, marginRight: 6 }}
          aria-hidden="true"
        >
          <rect width="40" height="40" rx="6" fill="#0D1117" />
          <path d="M12 8 L9 8 L9 32 L12 32" stroke="#00C9A7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M28 8 L31 8 L31 32 L28 32" stroke="#00C9A7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

        {/* TTL filter */}
        <div style={styles.ttlControl}>
          {TTL_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              style={{
                ...styles.ttlBtn,
                ...(ttlDays === opt.days ? styles.ttlBtnActive : {}),
              }}
              onClick={() => setTtlDays(opt.days)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content — tree fills space, panels overlay from right */}
      <div style={styles.content}>
        <ProjectSessionTree
          sessions={sessions}
          ttlDays={ttlDays}
          selected={selectedId}
          onSelect={handleSelect}
          onSelectProject={handleSelectProject}
        />

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
  ttlControl: {
    marginLeft: "auto",
    display: "flex",
    gap: 2,
    // @ts-ignore
    WebkitAppRegion: "no-drag",
  },
  ttlBtn: {
    background: "transparent",
    border: `0.5px solid ${tokens.surface2}`,
    borderRadius: tokens.radiusXs,
    color: tokens.muted,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "2px 7px",
    letterSpacing: "0.04em",
  },
  ttlBtnActive: {
    background: tokens.surface2,
    color: tokens.highlight,
    border: `0.5px solid ${tokens.border}`,
  },
  content: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
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
