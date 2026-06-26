/* Design system tokens — TypeScript mirror of tokens.css + gc-states.css.
   Use these for inline React styles. CSS classes (gc-chip, gc-dot) handle
   animations and states that inline styles can't express. */

export const tokens = {
  // white with 5% opacity
  // standard white-on-black header row color
  headerRow: "rgba(255, 255, 255, 0.05)",
  void: "#1C1C1C",
  surface0: "#222222",
  surface1: "#2A2A2A",
  surface2: "#333333",
  border: "#444444",
  muted: "#888888",
  text: "#E0E0E0",
  highlight: "#F8F8F8",

  fontMono: "'Berkeley Mono', 'JetBrains Mono', 'Fira Code', ui-monospace, monospace",

  fsDisplay: 22,
  fsSection: 15,
  fsBody: 13,
  fsLabel: 11,
  fsData: 12,
  fsMicro: 10,

  sp1: 4,
  sp2: 8,
  sp3: 12,
  sp4: 16,
  sp6: 24,
  sp10: 40,

  radiusXs: 2,
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 12,
  radiusPill: 999,
} as const;

export const gc = {
  clean: {
    dot: "#22C55E",
    text: "#4ADE80",
    bg: "#0A1F0F",
    border: "#166534",
  },
  soft_gc: {
    dot: "#F59E0B",
    text: "#FBBF24",
    bg: "#1C1408",
    border: "#92400E",
  },
  hard_gc: {
    dot: "#EF4444",
    text: "#F87171",
    bg: "#1F0A0A",
    border: "#991B1B",
  },
  aged: {
    dot: "#64748B",
    text: "#94A3B8",
    bg: "#111118",
    border: "#334155",
  },
} as const;

export type GCTokenKey = keyof typeof gc;
