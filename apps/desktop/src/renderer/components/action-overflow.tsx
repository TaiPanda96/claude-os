import { useEffect, useRef, useState } from "react";
import { gc } from "../theme.js";
import { styles } from "./action-overflow-styles-config.js";

// Reusable overflow menu for actions on session rows, project headers, and policy
// banners. Accepts a list of actions with labels, glyphs, descriptions, and
// disabled/danger states, and handles all the open/close/positioning logic.
export interface ActionOverflowType {
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

interface ActionOverflowProps {
  actions: ActionOverflowType[];
  ariaLabel?: string;
}

export function ActionOverflow({ actions, ariaLabel = "Row actions" }: ActionOverflowProps) {
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
      setCoords({ top: r.bottom + 4, left: Math.max(8, r.right - ((styles.menu?.width as number) ?? 0)) });
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
