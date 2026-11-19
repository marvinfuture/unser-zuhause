import { HttpError, type AppContext } from "./app.js";
import type { Store } from "./db.js";
import type { Task } from "../shared/types.js";
import type {
  TaskChange,
  TaskHistoryPage,
  TaskRevision,
} from "../shared/task-history.js";

const fields: (keyof Task)[] = [
  "title",
  "description",
  "status",
  "priority",
  "phase",
  "assignees",
  "startDate",
  "dueDate",
  "projectId",
  "roomId",
  "defectId",
  "predecessorIds",
  "archivedAt",
  "completedBy",
];

/** Hält die damaligen Namen verknüpfter Einträge auch nach deren späterer Umbenennung fest. */
function referenceLabel(
  db: Store,
  field: keyof Task,
  value: unknown,
): string | undefined {
  if (field === "predecessorIds" && Array.isArray(value))
    return (
      value
        .map((id) => db.get<Task>("tasks", id)?.title ?? "Unbekannte Aufgabe")
        .join(", ") || "Keine"
    );
  const kind =
    field === "projectId"
      ? "projects"
      : field === "roomId"
        ? "rooms"
        : field === "defectId"
          ? "defects"
          : undefined;
  if (kind && typeof value === "string")
    return (
      db.get<{ title: string }>(kind, value)?.title ?? "Unbekannter Eintrag"
    );
}

/** Protokolliert echte Feldänderungen in derselben Transaktion wie die Aufgabe. */
export function recordTaskHistory(
  db: Store,
  previous: Task | undefined,
  next: Task,
): void {
  const changes: TaskChange[] = [];
  for (const field of fields) {
    const before = previous?.[field] ?? null;
    const after = next[field] ?? null;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push({
      field,
      before,
      after,
      beforeLabel: referenceLabel(db, field, before),
      afterLabel: referenceLabel(db, field, after),
    });
  }
  if (previous && !changes.length) return;
  db.raw
    .prepare(
      "INSERT INTO task_history(task_id,version,actor,at,action,changes) VALUES(?,?,?,?,?,?)",
    )
    .run(
      next.id,
      next.version,
      next.updatedBy,
      next.updatedAt,
      previous ? "changed" : "created",
      JSON.stringify(changes),
    );
}

/** Liefert den Verlauf in stabilen Seiten und kennzeichnet fehlende Details aus älteren Versionen. */
export function registerTaskHistory(ctx: AppContext): void {
  ctx.app.get("/api/tasks/:id/history", ctx.requireSession, (req, res) => {
    ctx.getActor(req);
    const task = ctx.db.get<Task>("tasks", String(req.params.id));
    if (!task)
      throw new HttpError(
        404,
        "Diese Aufgabe wurde nicht gefunden.",
        "NOT_FOUND",
      );
    const before =
      req.query.before === undefined
        ? task.version + 1
        : Number(req.query.before);
    if (!Number.isSafeInteger(before) || before < 1)
      throw new HttpError(400, "Ungültige Verlaufsseite.", "VALIDATION");
    const created = ctx.db.raw
      .prepare(
        "SELECT 1 FROM task_history WHERE task_id=? AND version=1 AND action='created'",
      )
      .get(task.id);
    const rows = ctx.db.raw
      .prepare(
        "SELECT version,actor,at,action,changes FROM task_history WHERE task_id=? AND version<? ORDER BY version DESC LIMIT 26",
      )
      .all(task.id, before) as unknown as (Omit<TaskRevision, "changes"> & {
      changes: string;
    })[];
    const entries: TaskRevision[] = rows
      .slice(0, 25)
      .map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
    // Vor Migration 4 sind nur die originale Urheberschaft und Erstellungszeit belegt.
    if (!created && rows.length <= 25 && before > 1)
      entries.push({
        version: 1,
        actor: task.createdBy,
        at: task.createdAt,
        action: "created",
        changes: [],
      });
    res.json({
      entries,
      nextBefore: rows.length > 25 ? entries.at(-1)!.version : null,
      partial: !created,
    } satisfies TaskHistoryPage);
  });
}
