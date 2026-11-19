import type { ProfileId, Task } from "./types.js";

export interface TaskChange {
  field: keyof Task;
  before: unknown;
  after: unknown;
  beforeLabel?: string;
  afterLabel?: string;
}

export interface TaskRevision {
  version: number;
  actor: ProfileId;
  at: string;
  action: "created" | "changed";
  changes: TaskChange[];
}

export interface TaskHistoryPage {
  entries: TaskRevision[];
  nextBefore: number | null;
  partial: boolean;
}
