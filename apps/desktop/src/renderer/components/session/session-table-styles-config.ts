import { tokens, gc } from "../../theme";
import type { CSSProperties } from "react";

export const sessionTableStyles: Record<string, CSSProperties> = {
  container: {
    flex: 1,
    overflowY: "auto",
    background: tokens.void,
  },
  table: {
    width: "100%",
    // separate (not collapse) + zero spacing: under borderCollapse:collapse Chromium
    // paints sticky <th> backgrounds transparently, letting scrolled rows bleed through.
    borderCollapse: "separate",
    borderSpacing: 0,
    tableLayout: "fixed",
  },
  headerRow: {},
  th: {
    // Sticky lives on the cells, not the <tr>/<thead> — with borderCollapse:collapse
    // Chromium drops sticky on row/section elements, so per-cell is the reliable path.
    position: "sticky" as const,
    top: 0,
    zIndex: 2,
    padding: "11px 16px",
    fontSize: tokens.fsMicro,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
    userSelect: "none" as const,
    // Solid, distinct fill (not surface1, which sits on top of the row/void color
    // and reads as see-through) so scrolled rows can't bleed through the sticky cell.
    background: tokens.surface2,
    // boxShadow draws the divider instead of border — a collapsed border would
    // scroll out from under the sticky cell, leaving the header floating bare.
    boxShadow: `inset 0 -1px 0 ${tokens.border}`,
  },
  row: {
    borderBottom: `0.5px solid ${tokens.surface1}`,
    cursor: "pointer",
    transition: "background 0.2s",
  },
  rowSelected: {
    background: tokens.surface2,
  },
  td: {
    padding: "8px 16px",
    verticalAlign: "middle",
  },
  sessionCell: {
    display: "flex",
    alignItems: "center",
    gap: tokens.sp2,
  },
  sessionName: {
    fontSize: tokens.fsBody,
    fontWeight: 500,
    fontFamily: tokens.fontMono,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  sessionId: {
    color: tokens.border,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    flexShrink: 0,
  },
  mono: {
    color: tokens.text,
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  barTrack: {
    position: "relative",
    height: 3,
    background: tokens.surface2,
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 3,
  },
  barFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    borderRadius: 999,
    transition: "width 0.4s ease",
    zIndex: 1,
  },
  barZone: {
    position: "absolute",
    top: 0,
    width: "20%",
    height: "100%",
  },
  barMeta: {
    display: "flex",
    alignItems: "baseline",
    fontFamily: tokens.fontMono,
    fontSize: tokens.fsMicro,
  },
  barPct: {
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  barTokens: {
    color: tokens.muted,
  },
  // Cost — neutral treatment so it never competes with the GC color language.
  costAmount: {
    color: tokens.text,
    fontSize: tokens.fsData,
    fontWeight: 600,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  costTrack: {
    height: 3,
    background: tokens.surface2,
    borderRadius: 999,
    overflow: "hidden",
    margin: "3px 0",
  },
  costFill: {
    height: "100%",
    borderRadius: 999,
    background: tokens.muted,
    transition: "width 0.4s ease",
  },
  costSub: {
    color: tokens.muted,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  empty: {
    padding: 32,
    textAlign: "center" as const,
    color: tokens.muted,
    fontSize: tokens.fsBody,
    fontFamily: tokens.fontMono,
  },
  forkBadge: {
    fontSize: tokens.fsMicro,
    color: gc.soft_gc.text,
    fontFamily: tokens.fontMono,
    background: gc.soft_gc.bg,
    border: `1px solid ${gc.soft_gc.border}`,
    borderRadius: tokens.radiusPill,
    padding: "1px 6px",
    flexShrink: 0,
  },
};
