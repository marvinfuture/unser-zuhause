import { z } from "zod";
import type { BaseRecord, ProfileId, Task } from "../shared/types.js";
import type { RewardAccount, Reward, RewardEntry, RewardState } from "../shared/rewards.js";
import type { Store } from "./db.js";
import { HttpError, readBody, type AppContext } from "./app.js";

const accountKey = "rewards:account";
const controls = {
  profileVersion: z.number().int().nonnegative(),
  settingsVersion: z.number().int().nonnegative(),
  requestId: z.string().uuid(),
};
const definition = {
  title: z.string().trim().min(1, "Bitte einen Namen für die Belohnung eingeben.").max(160),
  cost: z.number().int().min(1, "Eine Belohnung kostet mindestens einen Punkt.").max(1_000_000),
};
const rewardReference = { id: z.string().uuid(), version: z.number().int().positive() };
const commandSchema = z.discriminatedUnion("action", [
  z.object({ ...controls, action: z.literal("configure"), enabled: z.boolean() }).strict(),
  z.object({ ...controls, action: z.literal("create"), ...definition }).strict(),
  z
    .object({
      ...controls,
      action: z.literal("edit"),
      ...rewardReference,
      ...definition,
      archived: z.boolean(),
    })
    .strict(),
  z.object({ ...controls, action: z.literal("redeem"), ...rewardReference }).strict(),
]);
type Command = z.infer<typeof commandSchema>;

/** Liefert die getrennten Guthaben. Bis zur ersten Aktivierung wird nichts gespeichert. */
function account(db: Store): RewardAccount {
  return (
    db.getSetting<RewardAccount>(accountKey) ?? {
      enabled: false,
      version: 0,
      balances: { karla: 0, marvin: 0 },
    }
  );
}

/** Liefert den Katalog und die letzten Buchungen mit ihren ursprünglichen Titeln und Punktwerten. */
function rewardState(db: Store): RewardState {
  const rows = db.raw
    .prepare("SELECT json FROM records WHERE kind='rewardEntries' ORDER BY rowid DESC LIMIT 30")
    .all();
  return {
    ...account(db),
    rewards: db.list<Reward>("rewards"),
    recent: rows.map((row) => JSON.parse(String(row.json)) as RewardEntry),
  };
}

/** Erstellt die gemeinsamen Versions- und Autorenfelder einer neuen Belohnung oder Buchung. */
function recordBase(id: string, actor: ProfileId, time: string): BaseRecord {
  return {
    id,
    createdAt: time,
    updatedAt: time,
    createdBy: actor,
    updatedBy: actor,
    version: 1,
    archivedAt: null,
  };
}

/** Bucht innerhalb der Aufgabentransaktion einmalig einen Punkt für die Person, welche die Aufgabe abhakt. */
export function recordTaskReward(
  db: Store,
  previous: Pick<Task, "status"> | undefined,
  task: Pick<Task, "id" | "title" | "status" | "archivedAt" | "updatedBy" | "updatedAt">,
): void {
  if (task.status !== "done" || previous?.status === "done" || task.archivedAt) return;
  const current = account(db);
  const id = `task:${task.id}`;
  if (!current.enabled || db.get("rewardEntries", id)) return;
  const entry: RewardEntry = {
    ...recordBase(id, task.updatedBy, task.updatedAt),
    title: task.title,
    points: 1,
    sourceId: task.id,
  };
  db.put("rewardEntries", entry);
  db.setSetting(accountKey, {
    ...current,
    balances: {
      ...current.balances,
      [task.updatedBy]: current.balances[task.updatedBy] + entry.points,
    },
  });
}

/** Prüft Konto- und Katalogversion und ändert Einstellung, Angebot oder Guthaben in der laufenden Transaktion. */
function applyRewardCommand(db: Store, actor: ProfileId, input: Command): void {
  const current = account(db);
  if (current.version !== input.settingsVersion)
    throw new HttpError(
      409,
      "Die Punktefunktion wurde inzwischen umgestellt. Bitte prüft den aktuellen Stand.",
      "REWARD_SETTINGS_CHANGED",
    );
  if (input.action === "configure") {
    if (current.enabled !== input.enabled)
      db.setSetting(accountKey, {
        ...current,
        enabled: input.enabled,
        version: current.version + 1,
      });
    return;
  }
  if (!current.enabled)
    throw new HttpError(409, "Schaltet die Punktefunktion zuerst ein.", "REWARDS_PAUSED");
  const now = new Date().toISOString();
  if (input.action === "create") {
    if (db.get("rewards", input.requestId))
      throw new HttpError(
        409,
        "Diese Belohnung wurde bereits angelegt. Bitte prüft den Katalog.",
        "REWARD_EXISTS",
      );
    const reward: Reward = {
      ...recordBase(input.requestId, actor, now),
      title: input.title,
      cost: input.cost,
    };
    db.put("rewards", reward);
    return;
  }
  const reward = db.get<Reward>("rewards", input.id);
  if (!reward) throw new HttpError(404, "Diese Belohnung wurde nicht gefunden.", "NOT_FOUND");
  if (reward.version !== input.version)
    throw new HttpError(
      409,
      "Diese Belohnung wurde inzwischen geändert. Bitte prüft den neuen Namen und Preis.",
      "REWARD_CHANGED",
    );
  if (input.action === "edit") {
    const updated = {
      ...reward,
      title: input.title,
      cost: input.cost,
      archivedAt: input.archived ? (reward.archivedAt ?? now) : null,
      version: reward.version + 1,
      updatedBy: actor,
      updatedAt: now,
    };
    db.put("rewards", updated);
    return;
  }
  if (reward.archivedAt)
    throw new HttpError(409, "Diese Belohnung ist im Archiv.", "REWARD_ARCHIVED");
  const entryId = `redeem:${input.requestId}`;
  // Die Buchung überlebt auch eine Rücksicherung, bei der kurzlebige Anfragekennungen entfernt werden.
  if (db.get("rewardEntries", entryId))
    throw new HttpError(
      409,
      "Diese Einlösung wurde bereits gebucht. Prüft den Punkteverlauf.",
      "REWARD_ALREADY_REDEEMED",
    );
  if (current.balances[actor] < reward.cost)
    throw new HttpError(
      409,
      "Dein Guthaben reicht für diese Belohnung noch nicht aus.",
      "INSUFFICIENT_POINTS",
    );
  const entry: RewardEntry = {
    ...recordBase(entryId, actor, now),
    title: reward.title,
    points: -reward.cost,
    sourceId: reward.id,
  };
  db.put("rewardEntries", entry);
  db.setSetting(accountKey, {
    ...current,
    balances: { ...current.balances, [actor]: current.balances[actor] + entry.points },
  });
}

/** Registriert die geschützte gemeinsame Punkteübersicht und wiederholsichere Änderungen für das gewählte Profil. */
export function registerRewards(ctx: AppContext): void {
  const { app, db, getActor, requireSession, requireWrite, assertProfile } = ctx;
  app.get("/api/rewards", requireSession, (req, res) => {
    getActor(req);
    res.json(rewardState(db));
  });
  app.post("/api/rewards", requireWrite, (req, res) => {
    const input = readBody(commandSchema, req.body);
    const actor = assertProfile(req, input.profileVersion);
    db.transaction(() => {
      const key = `rewards:${input.requestId}`;
      const signature = JSON.stringify([actor, input]);
      const processed = db.getIdempotent<string>(key);
      if (processed === signature) return;
      if (processed !== undefined)
        throw new HttpError(
          409,
          "Diese Anfragekennung gehört zu einer anderen Buchung.",
          "IDEMPOTENCY_CONFLICT",
        );
      applyRewardCommand(db, actor, input);
      db.saveIdempotent(key, signature);
    });
    res.json(rewardState(db));
  });
}
