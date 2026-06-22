import { tokens } from "../../theme";
import type { CSSProperties } from "react";

export const compactionHistoryStyles: Record<string, CSSProperties> = {
  container: {
    flexShrink: 0,
    maxHeight: 160,
    overflowY: "auto",
    borderTop: `0.5px solid ${tokens.border}`,
    background: tokens.void,
    padding: `${tokens.sp2}px ${tokens.sp6}px`,
  },
  heading: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: tokens.sp2,
    fontFamily: tokens.fontMono,
  },
  empty: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontFamily: tokens.fontMono,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.sp2,
  },
  row: {
    display: "flex",
    gap: tokens.sp2,
    alignItems: "flex-start",
  },
  icon: {
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    lineHeight: 1.3,
    width: 12,
    flexShrink: 0,
  },
  rowBody: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  rowMain: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.sp2,
    flexWrap: "wrap",
  },
  trigger: {
    fontSize: tokens.fsLabel,
    fontWeight: 600,
    fontFamily: tokens.fontMono,
    color: tokens.highlight,
  },
  time: {
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    color: tokens.muted,
    fontVariantNumeric: "tabular-nums",
  },
  fileCount: {
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    color: tokens.muted,
  },
  delta: {
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    color: tokens.muted,
    fontVariantNumeric: "tabular-nums",
  },
  failNote: {
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    color: tokens.muted,
  },
  files: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.sp1,
  },
  fileChip: {
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    color: tokens.text,
    background: tokens.surface0,
    border: `0.5px solid ${tokens.surface1}`,
    borderRadius: tokens.radiusXs,
    padding: "1px 5px",
  },
};
