import type { CSSProperties } from "react";
import { tokens } from "./theme.js";

// React's CSSProperties omits Electron's `WebkitAppRegion` (the draggable-titlebar
// hint), so we widen the map's value type to admit it — cleaner than an untyped
// `@ts-ignore` on every occurrence, and it keeps the values to the two legal options.
type AppCSS = CSSProperties & { WebkitAppRegion?: "drag" | "no-drag" };

export const appStyles: Record<string, AppCSS> = {
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
