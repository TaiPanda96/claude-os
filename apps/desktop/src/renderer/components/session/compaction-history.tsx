import { CompactionEventDetail, GC_TEXT } from "../../types.js";
import { tokens } from "../../theme.js";
import { compactionHistoryStyles as styles } from "./compaction-history-styles-config.js";

interface Props {
  events: CompactionEventDetail[];
}

/**
 * Per-session compaction history — every compaction this session produced
 * (newest first), including failures. A failed event is shown explicitly so the
 * "watermark only advances on success" behavior is visible rather than hidden.
 *
 * Read-only: consumes /sessions/:id/compaction-events; adds no persistence and
 * reuses the existing CompactionEventDetail type.
 */
export function CompactionHistory({ events }: Props) {
  return (
    <div style={styles.container}>
      <div style={styles.heading}>Compactions — what this session wrote to project memory</div>
      {events.length === 0 ? (
        <div style={styles.empty}>
          No compactions yet — this session hasn’t promoted anything to project memory.
        </div>
      ) : (
        <div style={styles.list}>
          {events.map((e) => (
            <CompactionRow key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A single compaction event; failed events surface the watermark behavior. */
function CompactionRow({ event }: { event: CompactionEventDetail }) {
  const failed = event.status === "failed";
  const running = event.status === "running";
  const icon = failed ? "✗" : running ? "⋯" : "✓";
  const iconColor = failed ? GC_TEXT.hard_gc : running ? tokens.muted : GC_TEXT.clean;
  const delta =
    event.output_size_tokens > 0 ? `+${(event.output_size_tokens / 1000).toFixed(1)}k tok` : null;
  const fileCount = event.files_written.length;

  return (
    <div style={styles.row}>
      <span style={{ ...styles.icon, color: iconColor }}>{icon}</span>
      <div style={styles.rowBody}>
        <div style={styles.rowMain}>
          <span style={styles.trigger}>{event.triggered_by}</span>
          <span style={styles.time}>{formatTime(event.started_at)}</span>
          {failed ? (
            <span style={styles.failNote}>failed — watermark not advanced</span>
          ) : (
            <>
              <span style={styles.fileCount}>
                {fileCount} file{fileCount === 1 ? "" : "s"}
              </span>
              {delta && <span style={styles.delta}>{delta}</span>}
            </>
          )}
        </div>
        {!failed && fileCount > 0 && (
          <div style={styles.files}>
            {event.files_written.map((f) => (
              <span key={f.filename} style={styles.fileChip}>
                {f.filename}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * started_at is an ISO timestamp; render local HH:MM. The renderer runs in the
 * browser where Date is available, so this is safe here (falls back to the raw
 * string if the timestamp is unparseable).
 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
