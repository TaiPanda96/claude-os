import { GCState } from "../types";

export const GC_LABEL: Record<GCState, string> = {
  clean: "Clean",
  soft_gc: "Soft GC",
  hard_gc: "Hard GC",
  aged: "Aged",
};
