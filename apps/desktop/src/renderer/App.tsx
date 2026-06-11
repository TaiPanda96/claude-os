import React, { useEffect, useState, useCallback } from "react";
import { SessionList } from "./components/SessionList.js";
import { EfficiencyCurve } from "./components/EfficiencyCurve.js";
import { ContextMeter } from "./components/ContextMeter.js";
import { SessionSummary } from "./components/SessionSummary.js";
import { SessionRow, SessionDetail, GCEvent, SERVER } from "./types.js";

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
      // Auto-select the most recently active session with turns
      if (!selectedId) {
        const first = data.find((s) => s.current_ctx_pct !== null);
        if (first) setSelectedId(first.id);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Cannot reach server at localhost:7842",
      );
    }
  }, [selectedId]);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const [detailRes, eventsRes] = await Promise.all([
        fetch(`${SERVER}/sessions/${id}`),
        fetch(`${SERVER}/sessions/${id}/gc-events`),
      ]);
      if (detailRes.ok) setDetail(await detailRes.json());
      if (eventsRes.ok) setGcEvents(await eventsRes.json());
    } catch {
      // non-critical — session may have been deleted
    }
  }, []);

  // Initial load + poll
  useEffect(() => {
    fetchSessions();
    const t = setInterval(fetchSessions, POLL_MS);
    return () => clearInterval(t);
  }, [fetchSessions]);

  // Fetch detail when selection changes
  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

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
      {/* Drag region for frameless window */}
      <div style={styles.titleBar}>
        <span style={styles.titleText}>Claude OS</span>
      </div>

      <div style={styles.body}>
        <SessionList
          sessions={sessions}
          selected={selectedId}
          onSelect={setSelectedId}
        />

        <div style={styles.main}>
          {selected && (
            <ContextMeter
              ctxPct={selected.current_ctx_pct ?? 0}
              turnCount={selected.turn_count}
              model={selected.model}
            />
          )}
          {detail && (
            <SessionSummary turns={detail.turns} gcEvents={gcEvents} />
          )}
          {detail ? (
            <EfficiencyCurve
              turns={detail.turns}
              sessionName={detail.session.name}
              gcEvents={gcEvents}
            />
          ) : (
            <div style={styles.placeholder}>
              {sessions.length === 0
                ? "No sessions — run bun run ingest"
                : "Select a session"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#0d0d0f",
    userSelect: "none",
  },
  titleBar: {
    height: 36,
    display: "flex",
    alignItems: "center",
    paddingLeft: 80, // space for traffic lights
    paddingRight: 16,
    borderBottom: "1px solid #2c2c2e",
    background: "#111113",
    // @ts-ignore — Electron-specific CSS property
    WebkitAppRegion: "drag",
    flexShrink: 0,
  },
  titleText: {
    fontSize: 13,
    fontWeight: 600,
    color: "#636366",
    letterSpacing: "0.04em",
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  placeholder: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#48484a",
    fontSize: 13,
    fontFamily: "monospace",
  },
  error: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorIcon: {
    fontSize: 32,
    color: "#ff3b30",
  },
  errorText: {
    color: "#636366",
    fontSize: 13,
    fontFamily: "monospace",
  },
  retryBtn: {
    marginTop: 4,
    padding: "6px 16px",
    background: "#1c1c1e",
    border: "1px solid #3a3a3c",
    borderRadius: 6,
    color: "#f2f2f7",
    fontSize: 12,
    cursor: "pointer",
  },
};
