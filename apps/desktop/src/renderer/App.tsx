import { useEffect, useState, useCallback } from "react";
import { CompactForkModal } from "./components/compact-fork-modal.js";
import { SessionRow, SessionDetail, GCEvent, Project, SERVER } from "./types.js";
import { appStyles } from "./app-styles-config.js";
import { DetailPanel } from "./components/detail-panel.js";
import { MemoryPanel } from "./components/memory/memory-panel.js";
import { ProjectSessionTree } from "./components/project/project-session-tree.js";
import { SessionTable } from "./components/session/session-table.js";
import { PolicyPanel } from "./components/policy/policy-panel.js";
import { SessionList } from "./components/session/session-list.js";

/**
 * Polling interval for fetching sessions and projects. We want this to be frequent enough that state changes (new sessions, policy updates)
 * are reflected in a timely manner, but not so frequent that it causes undue load or jank.
 * 5 seconds is a reasonable middle ground for a local-only tool like this, where changes are expected to be relatively infrequent and users will likely have multiple windows/tabs open.
 */
const POLL_MS = 5_000;
const TTL_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "All", days: 0 },
] as const;

/**
 * Main app component — fetches data and orchestrates the various views and panels. The session list and table are designed to be used together as a two-pane layout, but the
 * project/session tree views can be used standalone, so we switch between them with a
 * segmented control in the title bar.
 */
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
      <div style={appStyles.error}>
        <div style={appStyles.errorIcon}>⚠</div>
        <div style={appStyles.errorText}>{error}</div>
        <button style={appStyles.retryBtn} onClick={fetchSessions}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={appStyles.root}>
      {/* Title bar */}
      <div style={appStyles.titleBar}>
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
        <span style={appStyles.titleText}>Claude OS</span>
        <span style={appStyles.titleMeta}>
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
        </span>

        {/* Right-aligned controls: View mode + TTL filter */}
        <div style={appStyles.controls}>
          <div style={appStyles.segGroup}>
            {VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                style={{
                  ...appStyles.segBtn,
                  ...(view === opt.value ? appStyles.segBtnActive : {}),
                }}
                onClick={() => setView(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div style={appStyles.segGroup}>
            {TTL_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                style={{
                  ...appStyles.segBtn,
                  ...(ttlDays === opt.days ? appStyles.segBtnActive : {}),
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
      <div style={appStyles.content}>
        {view === "table" ? (
          // SessionList (left nav) + SessionTable (detail) — the two redesigned
          // session views, mounted as the two-pane layout they were built for.
          <div style={appStyles.tablePane}>
            <SessionList sessions={sessions} selected={selectedId} onSelect={handleSelect} />
            <SessionTable
              sessions={sessions}
              projects={projects}
              selected={selectedId}
              onSelect={handleSelect}
              onCompact={handleCompact}
              onFork={handleFork}
              onConfigurePolicy={handleSelectProject}
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
            onCompact={handleCompact}
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
