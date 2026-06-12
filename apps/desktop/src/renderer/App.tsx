import React, { useEffect, useState, useCallback } from "react";
import { SessionTable } from "./components/SessionTable.js";
import { DetailPanel } from "./components/DetailPanel.js";
import { SessionRow, SessionDetail, GCEvent, SERVER } from "./types.js";
import { tokens } from "./theme.js";

const POLL_MS = 5_000;

export function App() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [gcEvents, setGcEvents] = useState<GCEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER}/sessions`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data: SessionRow[] = await res.json();
      setSessions(data);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Cannot reach server at localhost:7842",
      );
    }
  }, []);

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

  useEffect(() => {
    fetchSessions();
    const t = setInterval(fetchSessions, POLL_MS);
    return () => clearInterval(t);
  }, [fetchSessions]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  function handleSelect(id: string) {
    // Toggle off if already selected
    if (id === selectedId) {
      setSelectedId(null);
      setDetail(null);
      setGcEvents([]);
    } else {
      setSelectedId(id);
    }
  }

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

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
        <svg width="16" height="16" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, marginRight: 6 }} aria-hidden="true">
          <rect width="40" height="40" rx="6" fill="#0D1117"/>
          <path d="M12 8 L9 8 L9 32 L12 32" stroke="#00C9A7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M28 8 L31 8 L31 32 L28 32" stroke="#00C9A7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="20" cy="14" r="2.5" fill="#00C9A7"/>
          <circle cx="15" cy="22" r="1.8" fill="#00C9A7" opacity="0.65"/>
          <circle cx="25" cy="22" r="1.8" fill="#00C9A7" opacity="0.65"/>
          <line x1="20" y1="14" x2="15" y2="22" stroke="#00C9A7" strokeWidth="0.8" opacity="0.5"/>
          <line x1="20" y1="14" x2="25" y2="22" stroke="#00C9A7" strokeWidth="0.8" opacity="0.5"/>
          <line x1="15" y1="22" x2="25" y2="22" stroke="#00C9A7" strokeWidth="0.6" opacity="0.3"/>
        </svg>
        <span style={styles.titleText}>Claude OS</span>
        <span style={styles.titleMeta}>
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Primary view — sessions table, fills all available space */}
      <SessionTable
        sessions={sessions}
        selected={selectedId}
        onSelect={handleSelect}
      />

      {/* Detail panel — slides in from bottom on row click */}
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
    height: 36,
    display: "flex",
    alignItems: "center",
    paddingLeft: 80,
    paddingRight: tokens.sp4,
    borderBottom: `0.5px solid ${tokens.border}`,
    background: tokens.surface0,
    // @ts-ignore
    WebkitAppRegion: "drag",
    flexShrink: 0,
  },
  titleText: {
    fontSize: tokens.fsBody,
    fontWeight: 600,
    color: tokens.muted,
    letterSpacing: "0.04em",
    fontFamily: tokens.fontMono,
  },
  titleMeta: {
    marginLeft: "auto",
    fontSize: tokens.fsLabel,
    color: tokens.border,
    fontFamily: tokens.fontMono,
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
  errorText: { color: tokens.muted, fontSize: tokens.fsBody, fontFamily: tokens.fontMono },
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
