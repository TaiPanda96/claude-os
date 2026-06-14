import React, { useEffect, useState } from "react";
import {
  CompactionPolicy,
  TriggerConfig,
  TriggerType,
  MemoryFile,
  SERVER,
} from "../types.js";
import { tokens, gc } from "../theme.js";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

const TRIGGER_LABELS: Record<TriggerType, string> = {
  turn_cadence: "Turn Cadence",
  ctx_threshold: "Context Threshold",
  architectural_decision: "Architectural Decision",
  outcome_resolved: "Outcome Resolved",
  semantic_event: "Semantic Classifier",
};

const DEFAULT_POLICY: Omit<CompactionPolicy, "id" | "project_id" | "created_at" | "updated_at"> = {
  name: "Default",
  active: true,
  triggers: [],
  memory_schema: [],
  cooldown_turns: 2,
};

export function PolicyPanel({ projectId, projectName, onClose }: Props) {
  const [policy, setPolicy] = useState<CompactionPolicy | null>(null);
  const [draft, setDraft] = useState<typeof DEFAULT_POLICY>(DEFAULT_POLICY);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addingTrigger, setAddingTrigger] = useState(false);
  const [newTriggerType, setNewTriggerType] = useState<TriggerType>("ctx_threshold");

  useEffect(() => {
    fetch(`${SERVER}/projects/${projectId}/policy`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: CompactionPolicy | null) => {
        if (p) {
          setPolicy(p);
          setDraft({
            name: p.name,
            active: p.active,
            triggers: p.triggers,
            memory_schema: p.memory_schema,
            cooldown_turns: p.cooldown_turns,
          });
        }
      })
      .catch(() => {});
  }, [projectId]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${SERVER}/projects/${projectId}/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved: CompactionPolicy = await res.json();
      setPolicy(saved);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function removeTrigger(i: number) {
    setDraft((d) => ({ ...d, triggers: d.triggers.filter((_, idx) => idx !== i) }));
  }

  function addTrigger() {
    const base = defaultTrigger(newTriggerType);
    setDraft((d) => ({ ...d, triggers: [...d.triggers, base] }));
    setAddingTrigger(false);
  }

  function updateTrigger(i: number, patch: Partial<TriggerConfig>) {
    setDraft((d) => ({
      ...d,
      triggers: d.triggers.map((t, idx) => (idx === i ? ({ ...t, ...patch } as TriggerConfig) : t)),
    }));
  }

  function addMemoryFile() {
    const f: MemoryFile = {
      filename: "memory.md",
      description: "",
      update_mode: "append",
      decay: "project",
    };
    setDraft((d) => ({ ...d, memory_schema: [...d.memory_schema, f] }));
  }

  function updateMemoryFile(i: number, patch: Partial<MemoryFile>) {
    setDraft((d) => ({
      ...d,
      memory_schema: d.memory_schema.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
    }));
  }

  function removeMemoryFile(i: number) {
    setDraft((d) => ({ ...d, memory_schema: d.memory_schema.filter((_, idx) => idx !== i) }));
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.headerTitle}>Compaction Policy</div>
            <div style={styles.headerSub}>{projectName}</div>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={styles.body}>
          {/* Active toggle + name */}
          <div style={styles.row}>
            <label style={styles.label}>Policy name</label>
            <input
              style={styles.input}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>

          <div style={styles.row}>
            <label style={styles.label}>Active</label>
            <div
              style={{
                ...styles.toggle,
                background: draft.active ? gc.clean.dot : tokens.surface2,
              }}
              onClick={() => setDraft((d) => ({ ...d, active: !d.active }))}
            >
              <div
                style={{
                  ...styles.toggleThumb,
                  transform: draft.active ? "translateX(16px)" : "translateX(2px)",
                }}
              />
            </div>
          </div>

          <div style={styles.row}>
            <label style={styles.label}>Cooldown turns</label>
            <input
              style={{ ...styles.input, width: 60 }}
              type="number"
              min={1}
              value={draft.cooldown_turns}
              onChange={(e) => setDraft((d) => ({ ...d, cooldown_turns: Number(e.target.value) }))}
            />
          </div>

          {/* Triggers */}
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionTitle}>Triggers</span>
              <button style={styles.addBtn} onClick={() => setAddingTrigger((v) => !v)}>
                + Add
              </button>
            </div>

            {addingTrigger && (
              <div style={styles.addRow}>
                <select
                  style={styles.select}
                  value={newTriggerType}
                  onChange={(e) => setNewTriggerType(e.target.value as TriggerType)}
                >
                  {(Object.keys(TRIGGER_LABELS) as TriggerType[]).map((t) => (
                    <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
                  ))}
                </select>
                <button style={styles.confirmBtn} onClick={addTrigger}>Add</button>
                <button style={styles.cancelBtn} onClick={() => setAddingTrigger(false)}>Cancel</button>
              </div>
            )}

            {draft.triggers.length === 0 && !addingTrigger && (
              <div style={styles.empty}>No triggers — policy won't fire.</div>
            )}

            {draft.triggers.map((t, i) => (
              <TriggerRow key={i} trigger={t} onChange={(p) => updateTrigger(i, p)} onRemove={() => removeTrigger(i)} />
            ))}
          </div>

          {/* Memory schema */}
          <div style={styles.section}>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionTitle}>Memory files</span>
              <button style={styles.addBtn} onClick={addMemoryFile}>+ Add</button>
            </div>

            {draft.memory_schema.length === 0 && (
              <div style={styles.empty}>No memory files defined.</div>
            )}

            {draft.memory_schema.map((f, i) => (
              <MemoryFileRow
                key={i}
                file={f}
                onChange={(p) => updateMemoryFile(i, p)}
                onRemove={() => removeMemoryFile(i)}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          {saveError && <span style={styles.saveError}>{saveError}</span>}
          <span style={styles.footerMeta}>
            {policy ? `last saved ${new Date(policy.updated_at).toLocaleTimeString()}` : "unsaved"}
          </span>
          <button style={styles.saveBtn} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save policy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Trigger row ───────────────────────────────────────────────────────────────

function TriggerRow({
  trigger,
  onChange,
  onRemove,
}: {
  trigger: TriggerConfig;
  onChange: (patch: Partial<TriggerConfig>) => void;
  onRemove: () => void;
}) {
  return (
    <div style={styles.triggerRow}>
      <div style={styles.triggerHeader}>
        <span style={styles.triggerLabel}>{TRIGGER_LABELS[trigger.triggerType as TriggerType]}</span>
        <button style={styles.removeBtn} onClick={onRemove}>✕</button>
      </div>

      {trigger.triggerType === "turn_cadence" && (
        <Field label="Every N turns">
          <input
            style={styles.input}
            type="number"
            min={1}
            value={trigger.every}
            onChange={(e) => onChange({ every: Number(e.target.value) } as any)}
          />
        </Field>
      )}

      {trigger.triggerType === "ctx_threshold" && (
        <Field label="Threshold (%)">
          <input
            style={styles.input}
            type="number"
            min={1}
            max={100}
            value={trigger.pct}
            onChange={(e) => onChange({ pct: Number(e.target.value) } as any)}
          />
        </Field>
      )}

      {(trigger.triggerType === "architectural_decision" ||
        trigger.triggerType === "outcome_resolved") && (
        <>
          <Field label="Min ctx %">
            <input
              style={styles.input}
              type="number"
              min={0}
              value={trigger.min_ctx_pct}
              onChange={(e) => onChange({ min_ctx_pct: Number(e.target.value) } as any)}
            />
          </Field>
          <Field label="Min turns">
            <input
              style={styles.input}
              type="number"
              min={0}
              value={trigger.min_turns}
              onChange={(e) => onChange({ min_turns: Number(e.target.value) } as any)}
            />
          </Field>
        </>
      )}

      {trigger.triggerType === "semantic_event" && (
        <>
          <Field label="Classifier prompt">
            <textarea
              style={{ ...styles.input, height: 60, resize: "vertical" as const }}
              value={trigger.classifier}
              onChange={(e) => onChange({ classifier: e.target.value } as any)}
            />
          </Field>
          <Field label="Min ctx %">
            <input
              style={styles.input}
              type="number"
              min={0}
              value={trigger.min_ctx_pct}
              onChange={(e) => onChange({ min_ctx_pct: Number(e.target.value) } as any)}
            />
          </Field>
          <Field label="Min turns">
            <input
              style={styles.input}
              type="number"
              min={0}
              value={trigger.min_turns}
              onChange={(e) => onChange({ min_turns: Number(e.target.value) } as any)}
            />
          </Field>
        </>
      )}
    </div>
  );
}

// ── Memory file row ───────────────────────────────────────────────────────────

function MemoryFileRow({
  file,
  onChange,
  onRemove,
}: {
  file: MemoryFile;
  onChange: (patch: Partial<MemoryFile>) => void;
  onRemove: () => void;
}) {
  return (
    <div style={styles.triggerRow}>
      <div style={styles.triggerHeader}>
        <span style={styles.triggerLabel}>{file.filename || "untitled"}</span>
        <button style={styles.removeBtn} onClick={onRemove}>✕</button>
      </div>
      <Field label="Filename">
        <input
          style={styles.input}
          value={file.filename}
          onChange={(e) => onChange({ filename: e.target.value })}
        />
      </Field>
      <Field label="Description">
        <input
          style={styles.input}
          value={file.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
      <div style={styles.fieldRow}>
        <Field label="Update mode">
          <select
            style={styles.select}
            value={file.update_mode}
            onChange={(e) => onChange({ update_mode: e.target.value as any })}
          >
            <option value="overwrite">Overwrite</option>
            <option value="append">Append</option>
            <option value="merge">Merge (LLM)</option>
          </select>
        </Field>
        <Field label="Decay">
          <select
            style={styles.select}
            value={file.decay}
            onChange={(e) => onChange({ decay: e.target.value as any })}
          >
            <option value="session">Session</option>
            <option value="project">Project</option>
            <option value="permanent">Permanent</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.field}>
      <label style={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultTrigger(type: TriggerType): TriggerConfig {
  switch (type) {
    case "turn_cadence":         return { triggerType: "turn_cadence", every: 10 };
    case "ctx_threshold":        return { triggerType: "ctx_threshold", pct: 70 };
    case "architectural_decision": return { triggerType: "architectural_decision", min_ctx_pct: 20, min_turns: 5 };
    case "outcome_resolved":     return { triggerType: "outcome_resolved", min_ctx_pct: 10, min_turns: 5 };
    case "semantic_event":       return { triggerType: "semantic_event", classifier: "", min_ctx_pct: 20, min_turns: 5 };
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "absolute",
    inset: 0,
    zIndex: 20,
    display: "flex",
    justifyContent: "flex-end",
    background: "rgba(0,0,0,0.4)",
  },
  panel: {
    width: 360,
    height: "100%",
    background: tokens.surface0,
    borderLeft: `0.5px solid ${tokens.border}`,
    display: "flex",
    flexDirection: "column",
    fontFamily: tokens.fontMono,
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "16px 16px 12px",
    borderBottom: `0.5px solid ${tokens.border}`,
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: tokens.fsBody,
    fontWeight: 600,
    color: tokens.highlight,
    letterSpacing: "0.01em",
  },
  headerSub: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    marginTop: 2,
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: tokens.muted,
    fontSize: 14,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  label: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    width: 100,
    flexShrink: 0,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  },
  input: {
    flex: 1,
    background: tokens.surface1,
    border: `0.5px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.highlight,
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    padding: "5px 8px",
    outline: "none",
  },
  select: {
    flex: 1,
    background: tokens.surface1,
    border: `0.5px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.highlight,
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    padding: "5px 8px",
    outline: "none",
    cursor: "pointer",
  },
  toggle: {
    width: 36,
    height: 20,
    borderRadius: 999,
    cursor: "pointer",
    position: "relative",
    transition: "background 0.2s",
    flexShrink: 0,
  },
  toggleThumb: {
    position: "absolute",
    top: 2,
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: tokens.highlight,
    transition: "transform 0.2s",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingTop: 8,
    borderTop: `0.5px solid ${tokens.surface2}`,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: tokens.fsLabel,
    color: tokens.muted,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  },
  addBtn: {
    background: "transparent",
    border: `0.5px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.highlight,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "3px 8px",
  },
  addRow: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  confirmBtn: {
    background: gc.clean.bg,
    border: `0.5px solid ${gc.clean.border}`,
    borderRadius: tokens.radiusSm,
    color: gc.clean.text,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "4px 10px",
  },
  cancelBtn: {
    background: "transparent",
    border: `0.5px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.muted,
    fontSize: tokens.fsMicro,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "4px 10px",
  },
  empty: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    fontStyle: "italic",
    padding: "4px 0",
  },
  triggerRow: {
    background: tokens.surface1,
    border: `0.5px solid ${tokens.surface2}`,
    borderRadius: tokens.radiusSm,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  triggerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  triggerLabel: {
    fontSize: tokens.fsData,
    color: tokens.text,
    fontWeight: 500,
  },
  removeBtn: {
    background: "transparent",
    border: "none",
    color: tokens.muted,
    fontSize: 11,
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: 1,
  },
  fieldLabel: {
    fontSize: tokens.fsMicro,
    color: tokens.muted,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
  },
  fieldRow: {
    display: "flex",
    gap: 8,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    borderTop: `0.5px solid ${tokens.border}`,
    flexShrink: 0,
  },
  footerMeta: {
    flex: 1,
    fontSize: tokens.fsMicro,
    color: tokens.muted,
  },
  saveError: {
    fontSize: tokens.fsMicro,
    color: gc.hard_gc.text,
    flex: 1,
  },
  saveBtn: {
    background: tokens.surface2,
    border: `0.5px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    color: tokens.highlight,
    fontSize: tokens.fsData,
    fontFamily: tokens.fontMono,
    cursor: "pointer",
    padding: "6px 14px",
  },
};
