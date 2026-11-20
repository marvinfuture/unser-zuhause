import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  addDays,
  calendarKinds,
  calendarOccurrences,
  hasOccurrence,
  reminderDate,
  singleOccurrence,
  validDay,
  type CalendarData,
  type CalendarFields,
  type CalendarKind,
  type CalendarOverride,
  type CalendarSeries,
} from '../shared/calendar.js';
import { localDay, PROFILE_IDS, type ProfileId, type ShoppingItem } from '../shared/types.js';
import { HttpError, readBody, type AppContext } from './app.js';
import type { Store } from './db.js';

const day = z.string().refine(validDay, 'Bitte ein gültiges Kalenderdatum angeben.');
const fields = z.object({
  title: z.string().trim().min(1, 'Bitte einen Titel angeben.').max(160),
  kind: z.enum(['event', 'waste', 'household']),
  startDay: day,
  everyWeeks: z.number().int().min(1).max(520).nullable(),
  endDay: day.nullable(),
  remindDays: z.number().int().min(0).max(365).nullable(),
  remindTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Bitte eine gültige Uhrzeit angeben.'),
  profileIds: z
    .array(z.enum(PROFILE_IDS))
    .min(1)
    .max(2)
    .refine((ids) => new Set(ids).size === ids.length, 'Ein Profil wurde doppelt gewählt.'),
});
const profileVersion = z.number().int().min(0);
const version = z.number().int().positive();
const create = fields.extend({ requestId: z.string().uuid(), profileVersion }).strict();
const edit = fields
  .partial()
  .extend({ archived: z.boolean().optional(), version, profileVersion })
  .strict();
const occurrenceAction = z
  .object({
    action: z.enum(['move', 'skip', 'done', 'reopen', 'shopping']),
    movedTo: day.optional(),
    version: z.number().int().min(0),
    seriesVersion: version,
    profileVersion,
  })
  .strict();

/** Prüft die fachlichen Grenzen einer Terminserie auch nach Teiländerungen. */
function checkSchedule(series: CalendarFields): void {
  if (series.endDay && (!series.everyWeeks || series.endDay < series.startDay))
    throw new HttpError(
      400,
      'Das Serienende muss am oder nach dem ersten Termin liegen und benötigt eine Wiederholung.',
      'INVALID_END',
    );
}

/** Ergänzt für alte Einzeltermine das wirksame Datum und den tatsächlichen Schlüssel ihrer früheren Aktionen, ohne den Bestand umzuschreiben. */
function resolveCalendarSeries(
  series: CalendarSeries,
  overrides: CalendarOverride[],
): CalendarSeries {
  if (series.everyWeeks || series.occurrenceDay) return series;
  const occurrence = singleOccurrence(
    series,
    overrides.filter((row) => row.seriesId === series.id),
  );
  return { ...series, startDay: occurrence.day, occurrenceDay: occurrence.originalDay };
}

/** Liest Serien und ihre einzelnen Ausnahmen aus dem gemeinsamen, gesicherten SQLite-Datenbestand. */
function calendarData(db: Store): CalendarData {
  const overrides = db.list<CalendarOverride>('calendarOverrides');
  return {
    series: db
      .list<CalendarSeries>('calendar')
      .map((series) => resolveCalendarSeries(series, overrides)),
    overrides,
  };
}

/** Übernimmt beim Wechsel zur Wiederholung den Status und den Einkaufsbezug des Einzeltermins auf den ersten regulären Serientag. */
function beginRecurrence(db: Store, current: CalendarSeries, next: CalendarSeries): void {
  const sourceId = current.id + ':' + current.occurrenceDay;
  const source = db.get<CalendarOverride>('calendarOverrides', sourceId);
  const targetId = next.id + ':' + next.startDay;
  if (source) {
    if (sourceId !== targetId && db.get('calendarOverrides', targetId))
      throw new HttpError(
        409,
        'Für den gewählten Serienbeginn gibt es bereits eine andere gespeicherte Terminaktion. Bitte einen anderen Serienbeginn wählen.',
        'OCCURRENCE_CONFLICT',
      );
    if (sourceId !== targetId) db.remove('calendarOverrides', sourceId);
    db.put('calendarOverrides', {
      ...source,
      id: targetId,
      originalDay: next.startDay,
      movedTo: null,
      version: source.version + 1,
    } as CalendarOverride);
  }
  delete next.occurrenceDay;
}

export interface CalendarReminder {
  key: string;
  previousDateKey?: string;
  seriesId: string;
  seriesVersion: number;
  occurrenceVersion: number;
  title: string;
  body: string;
  date: string;
  kind: CalendarKind;
  dueAt: string;
  profileIds: ProfileId[];
}
const dayLabel = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** Liefert offene Sendeaufträge der vergangenen 24 Stunden für den Hintergrunddienst; ältere offene Erinnerungen bleiben im Kalender sichtbar. */
export function dueCalendarReminders(db: Store, now: Date): CalendarReminder[] {
  const data = calendarData(db);
  data.series = data.series.filter((series) => !series.archivedAt && series.remindDays !== null);
  if (!data.series.length) return [];
  const since = now.getTime() - 86_400_000;
  const today = localDay(now);
  const to = addDays(today, Math.max(...data.series.map((series) => series.remindDays!)));
  const reminders: CalendarReminder[] = [];
  for (const item of calendarOccurrences(data, localDay(new Date(since)), to)) {
    if (item.exception && item.exception.status !== 'open') continue;
    const due = reminderDate(item.series, item.day)!;
    if (due.getTime() <= since || due > now) continue;
    reminders.push({
      key: item.series.id + ':' + item.originalDay,
      // Ältere Stände konnten denselben Einzeltermin unter dem neu eingetragenen Datum schon zugestellt haben.
      ...(!item.series.everyWeeks && item.originalDay !== item.day
        ? { previousDateKey: item.series.id + ':' + item.day }
        : {}),
      seriesId: item.series.id,
      seriesVersion: item.series.version,
      occurrenceVersion: item.exception?.version ?? 0,
      title: item.series.title,
      body:
        calendarKinds[item.series.kind] +
        ' am ' +
        dayLabel.format(new Date(item.day + 'T12:00:00Z')),
      date: item.day,
      kind: item.series.kind,
      dueAt: due.toISOString(),
      profileIds: item.series.profileIds,
    });
  }
  return reminders;
}

/** Registriert die geschützten Kalenderaktionen, inklusive einmaliger Übernahme eines Bedarfs in die gemeinsame Einkaufsliste. */
export function registerCalendar(ctx: AppContext): void {
  const { app, db, requireSession, requireWrite, assertProfile } = ctx;
  /** Liefert eine bestehende Serie oder die fachliche Fehlermeldung für veraltete Links. */
  function getSeries(id: string): CalendarSeries {
    const series = db.get<CalendarSeries>('calendar', id);
    if (!series) throw new HttpError(404, 'Diesen Kalendereintrag gibt es nicht.', 'NOT_FOUND');
    return series.everyWeeks || series.occurrenceDay
      ? series
      : resolveCalendarSeries(series, db.list<CalendarOverride>('calendarOverrides'));
  }
  app.get('/api/calendar', requireSession, (req, res) => {
    ctx.getActor(req);
    res.json(calendarData(db));
  });
  app.post('/api/calendar', requireWrite, (req, res) => {
    const { requestId, profileVersion, ...input } = readBody(create, req.body);
    const actor = assertProfile(req, profileVersion);
    checkSchedule(input);
    const saved = db.transaction(() => {
      const key = 'calendar:create:' + requestId;
      const existing = db.getIdempotent<{
        input: string;
        actor: ProfileId;
        record: CalendarSeries;
      }>(key);
      const signature = JSON.stringify(input);
      if (existing) {
        if (existing.actor !== actor || existing.input !== signature)
          throw new HttpError(
            409,
            'Diese Anfragekennung wurde bereits für einen anderen Termin verwendet.',
            'IDEMPOTENCY_CONFLICT',
          );
        return existing.record;
      }
      const now = new Date().toISOString();
      const record: CalendarSeries = {
        ...input,
        ...(input.everyWeeks ? {} : { occurrenceDay: input.startDay }),
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        updatedBy: actor,
        version: 1,
        archivedAt: null,
      };
      db.put('calendar', record);
      db.saveIdempotent(key, { input: signature, actor, record });
      return record;
    });
    res.status(201).json(saved);
  });
  app.patch('/api/calendar/:id', requireWrite, (req, res) => {
    const { version, profileVersion, archived, ...changes } = readBody(edit, req.body);
    const actor = assertProfile(req, profileVersion);
    const updated = db.transaction(() => {
      const current = getSeries(String(req.params.id));
      if (current.version !== version)
        throw new HttpError(
          409,
          'Dieser Kalendereintrag wurde inzwischen geändert. Öffnet die aktuellen Angaben vor dem Speichern erneut.',
          'VERSION_CONFLICT',
          current,
        );
      const now = new Date().toISOString();
      const next = {
        ...current,
        ...changes,
        updatedBy: actor,
        updatedAt: now,
        version: current.version + 1,
      };
      if (archived !== undefined) next.archivedAt = archived ? now : null;
      checkSchedule(next);
      if (!current.everyWeeks && next.everyWeeks) beginRecurrence(db, current, next);
      if (current.everyWeeks && !next.everyWeeks) next.occurrenceDay = next.startDay;
      db.put('calendar', next);
      return next;
    });
    res.json(updated);
  });
  app.post('/api/calendar/:id/occurrences/:day', requireWrite, (req, res) => {
    const input = readBody(occurrenceAction, req.body);
    const actor = assertProfile(req, input.profileVersion);
    const originalDay = readBody(day, req.params.day);
    const updated = db.transaction(() => {
      const series = getSeries(String(req.params.id));
      if (series.archivedAt)
        throw new HttpError(409, 'Dieser Kalendereintrag ist archiviert.', 'ARCHIVED');
      if (series.version !== input.seriesVersion)
        throw new HttpError(
          409,
          'Die Serie wurde inzwischen geändert. Prüft die aktuellen Termine.',
          'VERSION_CONFLICT',
        );
      const id = series.id + ':' + originalDay;
      const current = db.get<CalendarOverride>('calendarOverrides', id);
      const exists = series.everyWeeks
        ? !!current || hasOccurrence(series, originalDay)
        : originalDay === series.occurrenceDay;
      if (!exists)
        throw new HttpError(404, 'An diesem Tag gibt es keinen solchen Serientermin.', 'NOT_FOUND');
      if (input.action === 'shopping' && current?.shoppingId && current.status === 'done')
        return current;
      if ((current?.version ?? 0) !== input.version)
        throw new HttpError(
          409,
          'Dieser einzelne Termin wurde inzwischen geändert. Prüft seinen aktuellen Stand.',
          'VERSION_CONFLICT',
        );
      const now = new Date().toISOString();
      const next: CalendarOverride = {
        id,
        seriesId: series.id,
        originalDay,
        movedTo: null,
        status: 'open',
        shoppingId: null,
        archivedAt: null,
        createdAt: now,
        createdBy: actor,
        ...current,
        version: (current?.version ?? 0) + 1,
        updatedAt: now,
        updatedBy: actor,
      };
      switch (input.action) {
        case 'move':
          if (!input.movedTo)
            throw new HttpError(400, 'Bitte das neue Datum wählen.', 'VALIDATION');
          next.movedTo = input.movedTo === originalDay ? null : input.movedTo;
          // Beide Bearbeitungswege eines Einzeltermins ändern dasselbe Datum. Die Serienversion schützt offene Formulare auf dem zweiten Gerät.
          if (!series.everyWeeks && input.movedTo !== series.startDay) {
            const movedSeries: CalendarSeries = {
              ...series,
              startDay: input.movedTo,
              version: series.version + 1,
              updatedBy: actor,
              updatedAt: now,
            };
            db.put('calendar', movedSeries);
          }
          break;
        case 'skip':
          next.status = 'skipped';
          break;
        case 'done':
          next.status = 'done';
          break;
        case 'reopen':
          next.status = 'open';
          break;
        case 'shopping': {
          if (series.kind !== 'household' || next.status !== 'open')
            throw new HttpError(
              409,
              'Nur offenen Haushaltsbedarf könnt ihr auf die Einkaufsliste setzen.',
              'NOT_OPEN_HOUSEHOLD',
            );
          if (!next.shoppingId) {
            const item: ShoppingItem = {
              id: randomUUID(),
              title: series.title,
              category: 'household',
              projectId: null,
              quantity: 1,
              unit: 'Stück',
              unitPriceCents: null,
              purchased: false,
              purchasedBy: null,
              version: 1,
              archivedAt: null,
              createdAt: now,
              updatedAt: now,
              createdBy: actor,
              updatedBy: actor,
            };
            db.put('shopping', item);
            next.shoppingId = item.id;
          }
          next.status = 'done';
          break;
        }
      }
      db.put('calendarOverrides', next);
      return next;
    });
    res.json(updated);
  });
}
