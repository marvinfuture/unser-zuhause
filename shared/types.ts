export const PROFILE_IDS = ["karla", "marvin"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];
export interface Profile {
  id: ProfileId;
  name: string;
  color: string;
}
export type Priority = "urgent" | "high" | "normal" | "later";
export const TASK_PHASES = [
  "planning",
  "preparation",
  "execution",
  "finishing",
] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];
export const taskPhaseLabels: Record<TaskPhase, string> = {
  planning: "Planung",
  preparation: "Vorbereitung",
  execution: "Renovierung",
  finishing: "Abschluss",
};
export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: ProfileId;
  updatedBy: ProfileId;
  version: number;
  archivedAt: string | null;
}
export interface Room extends BaseRecord {
  title: string;
  description: string;
  color: string;
  icon: string;
}
export interface Project extends BaseRecord {
  title: string;
  description: string;
  roomId: string | null;
  priority: Priority;
  status: "idea" | "planned" | "active" | "paused" | "done";
  startDate: string | null;
  dueDate: string | null;
  rank: number;
}
export interface Task extends BaseRecord {
  title: string;
  description: string;
  projectId: string | null;
  roomId: string | null;
  defectId: string | null;
  priority: Priority;
  status: "open" | "active" | "blocked" | "done";
  phase: TaskPhase;
  predecessorIds: string[];
  assignees: ProfileId[];
  startDate: string | null;
  dueDate: string | null;
  completedBy: ProfileId | null;
}
export interface ShoppingItem extends BaseRecord {
  title: string;
  projectId: string | null;
  category: "material" | "tool";
  quantity: number;
  unit: string;
  unitPriceCents: number | null;
  purchased: boolean;
  purchasedBy: ProfileId | null;
}
export interface Defect extends BaseRecord {
  title: string;
  description: string;
  roomId: string | null;
  projectId: string | null;
  priority: Priority;
  status: "open" | "active" | "resolved";
  assignees: ProfileId[];
  dueDate: string | null;
}
export interface Note extends BaseRecord {
  projectId: string;
  body: string;
  event: boolean;
}
export interface Photo extends BaseRecord {
  projectId: string | null;
  defectId: string | null;
  title: string;
  category: "before" | "progress" | "after";
  width: number;
  height: number;
  bytes: number;
  mime: string;
  deletedAt: string | null;
}
export interface Comparison extends BaseRecord {
  projectId: string;
  title: string;
  beforeId: string;
  afterId: string;
  beforeX: number;
  beforeY: number;
  afterX: number;
  afterY: number;
  beforeZoom: number;
  afterZoom: number;
}
export interface AppState {
  profiles: Profile[];
  rooms: Room[];
  projects: Project[];
  tasks: Task[];
  shopping: ShoppingItem[];
  defects: Defect[];
  notes: Note[];
  photos: Photo[];
  comparisons: Comparison[];
}
export interface Session {
  csrfToken: string;
  profileId: ProfileId | null;
  profileVersion: number;
  profiles: Profile[];
}
export type Collection =
  | "rooms"
  | "projects"
  | "tasks"
  | "shopping"
  | "defects"
  | "notes"
  | "comparisons";
export const profiles: Profile[] = [
  { id: "karla", name: "Karla", color: "#815773" },
  { id: "marvin", name: "Marvin", color: "#326e75" },
];
/**
 * Formatiert einen Zeitpunkt als Kalendertag YYYY-MM-DD in Europe/Berlin; dadurch richten sich Fälligkeiten nach eurem lokalen Tag.
 */
export function localDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
/**
 * Berechnet den gerundeten Anteil erledigter, nicht archivierter Projektaufgaben. Ohne aktive Aufgaben ergibt sich null statt eines irreführenden Prozentwerts.
 */
export function progress(projectId: string, tasks: Task[]): number | null {
  const items = tasks.filter((t) => t.projectId === projectId && !t.archivedAt);
  return items.length
    ? Math.round(
        (items.filter((t) => t.status === "done").length / items.length) * 100,
      )
    : null;
}
