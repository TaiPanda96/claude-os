import { tokens } from "../theme";
import type { CSSProperties } from "react";

/**
 * Kebab (⋯) trigger that opens a small popover menu of row actions. Self-contained:
 * owns its open state, closes on outside-click / Escape, and stops click propagation
 * so it never triggers the underlying row's onClick (selection).
 */
const MENU_WIDTH = 260;

export const styles: Record<string, CSSProperties> = {
  wrap: {
    position: "relative",
    display: "inline-flex",
  },
  trigger: {
    background: "transparent",
    border: `1px solid transparent`,
    borderRadius: tokens.radiusSm,
    color: tokens.muted,
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    lineHeight: 1,
    padding: "2px 8px",
    transition: "background 0.15s, color 0.15s",
  },
  triggerOpen: {
    background: tokens.surface2,
    color: tokens.highlight,
    borderColor: tokens.border,
  },
  menu: {
    position: "fixed",
    zIndex: 200,
    width: MENU_WIDTH,
    background: tokens.surface1,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
    padding: 4,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: tokens.sp2,
    width: "100%",
    textAlign: "left" as const,
    background: "transparent",
    border: "none",
    borderRadius: tokens.radiusSm,
    padding: `${tokens.sp2}px ${tokens.sp2}px`,
    cursor: "pointer",
  },
  itemDisabled: {
    cursor: "not-allowed",
    opacity: 0.45,
  },
  itemHover: {
    background: tokens.surface2,
  },
  glyph: {
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    color: tokens.muted,
    flexShrink: 0,
    width: 14,
    textAlign: "center" as const,
    lineHeight: 1.4,
  },
  itemText: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minWidth: 0,
  },
  labelRow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.sp2,
  },
  label: {
    fontSize: tokens.fsData,
    fontWeight: 600,
    color: tokens.highlight,
    fontFamily: tokens.fontMono,
  },
  badge: {
    fontSize: 9,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: tokens.muted,
    background: tokens.surface2,
    border: `0.5px solid ${tokens.border}`,
    borderRadius: tokens.radiusPill,
    padding: "1px 6px",
    fontFamily: tokens.fontMono,
  },
  desc: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    lineHeight: 1.4,
  },
};
