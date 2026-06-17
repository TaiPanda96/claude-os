import {
  app,
  Tray,
  Menu,
  nativeImage,
  Notification,
  BrowserWindow,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SERVER_ENTRY = path.join(REPO_ROOT, "packages/server/src/index.ts");
const POLL_INTERVAL_MS = 5_000;
const SERVER_URL = "http://localhost:7842";

// ── GC state ─────────────────────────────────────────────────────────────────

type GCState = "clean" | "soft_gc" | "hard_gc";

const GC_COLORS: Record<GCState, string> = {
  clean: "#34c759",
  soft_gc: "#ff9500",
  hard_gc: "#ff3b30",
};

const GC_LABELS: Record<GCState, string> = {
  clean: "Clean",
  soft_gc: "Soft GC",
  hard_gc: "Hard GC",
};

function toGCState(ctxPct: number): GCState {
  if (ctxPct >= 0.8) return "hard_gc";
  if (ctxPct >= 0.6) return "soft_gc";
  return "clean";
}

// ── Tray icon ────────────────────────────────────────────────────────────────

function makeTrayIcon(state: GCState): Electron.NativeImage {
  const color = GC_COLORS[state];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="6" fill="${color}"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

let serverProcess: ChildProcess | null = null;

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    serverProcess = spawn("bun", ["run", "--env-file", path.join(REPO_ROOT, ".env"), SERVER_ENTRY], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
      },
    });

    serverProcess.on("error", (err) => {
      clearInterval(ready);
      reject(
        new Error(`Failed to spawn bun: ${err.message}. Is bun installed?`),
      );
    });

    serverProcess.stderr?.on("data", (d) =>
      console.error("[server]", d.toString().trim()),
    );

    // Poll health endpoint until ready
    let attempts = 0;
    const ready = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch(`${SERVER_URL}/health`);
        if (r.ok) {
          clearInterval(ready);
          resolve();
        }
      } catch {
        if (attempts > 20) {
          clearInterval(ready);
          reject(new Error("Server failed to start after 10s"));
        }
      }
    }, 500);
  });
}

function stopServer() {
  serverProcess?.kill();
  serverProcess = null;
}

// ── Session polling ───────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  name: string | null;
  model: string;
  current_ctx_pct: number | null;
  turn_count: number;
}

async function fetchMostActiveSession(): Promise<SessionRow | null> {
  const res = await fetch(`${SERVER_URL}/sessions`);
  if (!res.ok) return null;
  const sessions = (await res.json()) as SessionRow[];
  // Most recently active session with at least one turn
  return sessions.find((s) => s.current_ctx_pct !== null) ?? null;
}

// ── App bootstrap ─────────────────────────────────────────────────────────────

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let lastGCState: GCState = "clean";
let lastTrend: "rising" | "flat" | "declining" = "flat";
let pollTimer: ReturnType<typeof setInterval> | null = null;

const IS_DEV =
  process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const RENDERER_URL = IS_DEV
  ? "http://localhost:5173"
  : `file://${path.join(__dirname, "../renderer/index.html")}`;

function createWindow() {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0d0d0f",
    webPreferences: { contextIsolation: true },
    show: false,
  });
  win.loadURL(RENDERER_URL);
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => {
    win = null;
  });
}

function buildContextMenu(
  session: SessionRow | null,
  gcState: GCState,
  ctxPct: number,
) {
  return Menu.buildFromTemplate([
    {
      label: session
        ? `${session.name ?? "unnamed"} — ${(ctxPct * 100).toFixed(1)}% ctx`
        : "No active session",
      enabled: false,
    },
    {
      label: `State: ${GC_LABELS[gcState]}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Open Activity Monitor",
      click: createWindow,
    },
    { type: "separator" },
    { label: "Quit Claude OS", click: () => app.quit() },
  ]);
}

async function fetchSessionHealth(sessionId: string) {
  try {
    const res = await fetch(`${SERVER_URL}/sessions/${sessionId}/health`);
    if (!res.ok) return null;
    return res.json() as Promise<{
      recentTrend: "rising" | "flat" | "declining";
      turnsToInflection: number | null;
      currentQuality: number;
      inflectionCtxPct: number | null;
    }>;
  } catch {
    return null;
  }
}

async function poll() {
  try {
    const session = await fetchMostActiveSession();
    const ctxPct = session?.current_ctx_pct ?? 0;
    const gcState = toGCState(ctxPct);

    if (!tray) return;

    tray.setImage(makeTrayIcon(gcState));
    tray.setContextMenu(buildContextMenu(session, gcState, ctxPct));

    // Fetch slope-based health for the active session
    const health = session ? await fetchSessionHealth(session.id) : null;
    const trend = health?.recentTrend ?? "flat";

    tray.setToolTip(
      session
        ? `Claude OS · ${Math.min(ctxPct * 100, 100).toFixed(1)}% · ${GC_LABELS[gcState]}${trend === "declining" ? " · ↓ degrading" : ""}`
        : "Claude OS · no active session",
    );

    // Phase 3 — proactive: fire when slope turns negative, before GC thresholds fire
    if (trend === "declining" && lastTrend !== "declining") {
      const turnsMsg =
        health?.turnsToInflection != null
          ? ` Quality may drop below threshold in ~${health.turnsToInflection} turns.`
          : "";
      new Notification({
        title: "Claude OS — Quality Declining",
        body: `Session "${session?.name ?? "unnamed"}" quality is trending down at ${Math.min(ctxPct * 100, 100).toFixed(0)}% context.${turnsMsg}`,
        silent: false,
      }).show();
    }

    // Reactive fallback: hard GC transition (threshold-based, kept as safety net)
    if (
      gcState === "hard_gc" &&
      lastGCState !== "hard_gc" &&
      lastTrend !== "declining"
    ) {
      new Notification({
        title: "Claude OS — Hard GC",
        body: `Session "${session?.name ?? "unnamed"}" is at ${Math.min(ctxPct * 100, 100).toFixed(0)}% context. Consider compacting.`,
        silent: false,
      }).show();
    }

    lastGCState = gcState;
    lastTrend = trend;
  } catch (err) {
    console.error("[poll]", err);
  }
}

app.whenReady().then(async () => {
  app.dock?.hide(); // menu bar only — no dock icon

  if (!IS_DEV) {
    try {
      await startServer();
    } catch (err) {
      console.error("Failed to start server:", err);
      app.quit();
      return;
    }
  }

  tray = new Tray(makeTrayIcon("clean"));
  tray.setToolTip("Claude OS — starting…");
  tray.setContextMenu(buildContextMenu(null, "clean", 0));
  tray.on("click", createWindow);

  await poll();
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
});

app.on("before-quit", () => {
  if (pollTimer) clearInterval(pollTimer);
  stopServer();
});

// Keep app alive even with no windows open
app.on("window-all-closed", () => {});
