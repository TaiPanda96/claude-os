import React, { useEffect, useRef, useState } from "react";
import { tokens, gc } from "../theme.js";

export interface OverflowAction {
  key: string;
  label: string;
  /** Secondary line explaining what the action does. */
  description?: string;
  /** Monospace glyph rendered to the left of the label. */
  glyph?: string;
  /** Disabled items render grayed and are not clickable (e.g. unshipped features). */
  disabled?: boolean;
  /** Destructive actions get a danger-tinted label. */
  danger?: boolean;
  /** Small trailing tag, e.g. "Soon" for grayed-out features. */
  badge?: string;
  onSelect?: () => void;
}

interface Props {
  actions: OverflowAction[];
  ariaLabel?: string;
}

/**
 * Kebab (⋯) trigger that opens a small popover menu of row actions. Self-contained:
 * owns its open state, closes on outside-click / Escape, and stops click propagation
 * so it never triggers the underlying row's onClick (selection).
 */
const MENU_WIDTH = 260;

export function ActionOverflow({ actions, ariaLabel = "Row actions" }: Props) {
  const [open, setOpen] = useState(false);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Menu is fixed-positioned off the trigger rect so it never clips against the
  // table's scroll container, regardless of which row it opens from.
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function toggle() {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_WIDTH) });
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Any scroll detaches the anchor — close rather than float out of place.
    function onScroll() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={styles.wrap} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        style={{ ...styles.trigger, ...(open ? styles.triggerOpen : {}) }}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        ⋯
      </button>

      {open && (
        <div role="menu" style={{ ...styles.menu, top: coords.top, left: coords.left }}>
          {actions.map((a) => (
            <button
              key={a.key}
              role="menuitem"
              disabled={a.disabled}
              title={a.disabled ? "Coming soon" : undefined}
              style={{
                ...styles.item,
                ...(a.disabled ? styles.itemDisabled : {}),
                ...(hoveredKey === a.key && !a.disabled ? styles.itemHover : {}),
              }}
              onMouseEnter={() => setHoveredKey(a.key)}
              onMouseLeave={() => setHoveredKey((k) => (k === a.key ? null : k))}
              onClick={(e) => {
                e.stopPropagation();
                if (a.disabled) return;
                setOpen(false);
                a.onSelect?.();
              }}
            >
              <span
                style={{
                  ...styles.glyph,
                  ...(a.danger && !a.disabled ? { color: gc.hard_gc.text } : {}),
                }}
              >
                {a.glyph}
              </span>
              <span style={styles.itemText}>
                <span style={styles.labelRow}>
                  <span
                    style={{
                      ...styles.label,
                      ...(a.danger && !a.disabled ? { color: gc.hard_gc.text } : {}),
                    }}
                  >
                    {a.label}
                  </span>
                  {a.badge && <span style={styles.badge}>{a.badge}</span>}
                </span>
                {a.description && <span style={styles.desc}>{a.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
