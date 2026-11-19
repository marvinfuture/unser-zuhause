import { localDay, type BaseRecord, type ProfileId } from './types.js';

export type CalendarKind = 'event' | 'waste' | 'household';
export interface CalendarFields {
  title: string;
  kind: CalendarKind;
  startDay: string;
  everyWeeks: number | null;
  endDay: string | null;
  remindDays: number | null;
  remindTime: string;
  profileIds: ProfileId[];
}
export interface CalendarSeries extends CalendarFields, BaseRecord {}
export interface CalendarOverride extends BaseRecord {
  seriesId: string;
  originalDay: string;
  movedTo: string | null;
  status: 'open' | 'done' | 'skipped';
  shoppingId: string | null;
}
export interface CalendarData {
  series: CalendarSeries[];
  overrides: CalendarOverride[];
}
export interface Occurrence {
  series: CalendarSeries;
  originalDay: string;
  day: string;
  exception?: CalendarOverride;
}
export const calendarKinds: Record<CalendarKind, string> = {
  event: 'Termin',
  waste: 'Müllabfuhr',
  household: 'Haushaltsbedarf',
};
const DAY = 86_400_000;
const berlinClock = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Prüft ein ISO-Kalenderdatum einschließlich Schaltjahren und der tatsächlichen Monatslänge. */
export function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < '1900-01-01') return false;
  const date = new Date(day + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** Verschiebt ein Kalenderdatum um ganze Tage, unabhängig von Zeitumstellungen und Gerätezeitzone. */
export function addDays(day: string, count: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + count * DAY).toISOString().slice(0, 10);
}

/** Berechnet den Abstand reiner Kalendertage ohne verkürzte oder verlängerte Tage bei der Zeitumstellung. */
function daysBetween(from: string, to: string): number {
  return (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY;
}

/** Prüft, ob ein Datum nach Serienregel tatsächlich vorkommt, einschließlich des letzten Serientages. */
export function hasOccurrence(series: CalendarFields, day: string): boolean {
  if (!validDay(day) || day < series.startDay || (series.endDay && day > series.endDay))
    return false;
  if (!series.everyWeeks) return day === series.startDay;
  return daysBetween(series.startDay, day) % (series.everyWeeks * 7) === 0;
}

/** Liefert die Termine im sichtbaren Zeitfenster. Verschobene und bereits bearbeitete Einzeltage behalten ihre Identität. */
export function calendarOccurrences(data: CalendarData, from: string, to: string): Occurrence[] {
  if (from > to) return [];
  const result: Occurrence[] = [];
  const bySeries = new Map<string, CalendarOverride[]>();
  for (const item of data.overrides) {
    const group = bySeries.get(item.seriesId) ?? [];
    group.push(item);
    bySeries.set(item.seriesId, group);
  }
  for (const series of data.series) {
    if (series.archivedAt) continue;
    const exceptions = bySeries.get(series.id) ?? [];
    const changed = new Set(exceptions.map((item) => item.originalDay));
    for (const exception of exceptions) {
      const day = exception.movedTo || exception.originalDay;
      if (day >= from && day <= to)
        result.push({ series, day, originalDay: exception.originalDay, exception });
    }
    const step = (series.everyWeeks ?? 1) * 7;
    const first = series.everyWeeks
      ? Math.max(0, Math.ceil(daysBetween(series.startDay, from) / step)) * step
      : 0;
    const last = Math.min(
      daysBetween(series.startDay, to),
      series.endDay ? daysBetween(series.startDay, series.endDay) : Infinity,
    );
    for (let offset = first; offset <= last; offset += step) {
      const day = addDays(series.startDay, offset);
      if (day >= from && !changed.has(day)) result.push({ series, day, originalDay: day });
      if (!series.everyWeeks) break;
    }
  }
  return result.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.series.title.localeCompare(b.series.title, 'de') ||
      a.originalDay.localeCompare(b.originalDay),
  );
}

/** Übersetzt die gewünschte Berliner Uhrzeit in einen eindeutigen Zeitpunkt. Im Herbst gilt die erste Stunde, bei einer Frühlingslücke die nächste passende Stunde. */
export function reminderDate(series: CalendarFields, day: string): Date | null {
  if (series.remindDays === null) return null;
  const reminderDay = addDays(day, -series.remindDays);
  const wallTime = Date.parse(reminderDay + 'T' + series.remindTime + ':00Z');
  const summer = new Date(wallTime - 2 * 3_600_000);
  if (berlinClock.format(summer) === series.remindTime) return summer;
  return new Date(wallTime - 3_600_000);
}

/** Findet fällige, noch offene Erinnerungen eines Profils, unabhängig vom im Kalender angezeigten Monat. */
export function openCalendarReminders(
  data: CalendarData,
  profileId: ProfileId,
  now: Date,
): Occurrence[] {
  const series = data.series.filter(
    (item) => !item.archivedAt && item.remindDays !== null && item.profileIds.includes(profileId),
  );
  if (!series.length) return [];
  let first = series.reduce(
    (min, item) => (item.startDay < min ? item.startDay : min),
    series[0].startDay,
  );
  for (const item of data.overrides) if (item.movedTo && item.movedTo < first) first = item.movedTo;
  const until = addDays(localDay(now), Math.max(...series.map((item) => item.remindDays ?? 0)));
  return calendarOccurrences({ series, overrides: data.overrides }, first, until).filter(
    (occurrence) => {
      if (occurrence.exception && occurrence.exception.status !== 'open') return false;
      return reminderDate(occurrence.series, occurrence.day)!.getTime() <= now.getTime();
    },
  );
}
