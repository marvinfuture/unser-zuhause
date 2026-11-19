import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  addDays,
  calendarKinds,
  calendarOccurrences,
  openCalendarReminders,
  type CalendarData,
  type CalendarFields,
  type CalendarSeries,
  type Occurrence,
} from '../shared/calendar';
import { localDay, profiles, type Session } from '../shared/types';
import { api, ApiError, hasSameAuthorContext } from './api';
import type { FeatureProps } from './feature-props';
import PushSettings from './PushSettings';

const labelFormat = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('de-DE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
type Action = 'done' | 'skip' | 'move' | 'reopen' | 'shopping';

/** Formatiert ein fachliches Tagesdatum unabhängig von der Zeitzone des Geräts. */
function dayLabel(day: string): string {
  return labelFormat.format(new Date(day + 'T12:00:00Z'));
}
/** Wählt den Nachbarmonat auch beim Übergang an Weihnachten und Neujahr. */
function shiftMonth(month: string, offset: number): string {
  const date = new Date(month + '-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
/** Liefert die Standardfelder für einen neuen einmaligen Termin mit Erinnerung am Vortag um 18 Uhr. */
function blankCalendar(day: string): CalendarFields {
  return {
    title: '',
    kind: 'event',
    startDay: day,
    everyWeeks: null,
    endDay: null,
    remindDays: 1,
    remindTime: '18:00',
    profileIds: ['karla', 'marvin'],
  };
}

/** Öffnet vom Einkauf aus direkt einen vierwöchigen Haushaltsbedarf, dessen Abstand frei änderbar ist. */
function householdDraft(): CalendarFields {
  return { ...blankCalendar(localDay()), kind: 'household', everyWeeks: 4 };
}

interface CalendarFormProps {
  initial: CalendarFields;
  series?: CalendarSeries;
  session: Session;
  busy: boolean;
  save: (value: CalendarFields, author: Session, requestId: string) => Promise<boolean>;
  close: () => void;
}

interface OpenCalendarForm {
  key: string;
  series?: CalendarSeries;
  initial: CalendarFields;
}
/** Erfasst oder ändert eine ganze Serie. Profil und Datensatzversion stammen aus dem bewusst geöffneten Formular. */
function CalendarForm({ initial, series, session, busy, save, close }: CalendarFormProps) {
  const [draft, setDraft] = useState<CalendarFields>(initial);
  const [author, setAuthor] = useState(session);
  const [requestId] = useState(() => crypto.randomUUID());
  const changedAuthor = !hasSameAuthorContext(author, session);
  /** Hält einzelne Felder als Entwurf fest, bis der Server das ganze Formular bestätigt. */
  function update<K extends keyof CalendarFields>(key: K, value: CalendarFields[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  /** Sendet nur die fachlichen Felder des Entwurfs und behält sie bei einem Konflikt bei. */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || changedAuthor) return;
    if (await save(draft, author, requestId)) close();
  }
  return (
    <section className="panel">
      <h2>{series ? 'Kalendereintrag bearbeiten' : 'Kalendereintrag anlegen'}</h2>
      <form className="form-grid" onSubmit={submit}>
        <label>
          Titel
          <input
            autoFocus
            required
            maxLength={160}
            value={draft.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="z. B. Papiertonne rausstellen"
          />
        </label>
        <label>
          Art
          <select
            value={draft.kind}
            onChange={(e) => update('kind', e.target.value as CalendarFields['kind'])}
          >
            {Object.entries(calendarKinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Erster Termin
          <input
            type="date"
            required
            min="1900-01-01"
            value={draft.startDay}
            onChange={(e) => update('startDay', e.target.value)}
          />
        </label>
        <label>
          Wiederholung
          <select
            value={draft.everyWeeks === null ? 'once' : 'series'}
            onChange={(e) =>
              setDraft((current) => ({
                ...current,
                everyWeeks: e.target.value === 'once' ? null : 1,
                endDay: null,
              }))
            }
          >
            <option value="once">Einmalig</option>
            <option value="series">Alle … Wochen</option>
          </select>
        </label>
        {draft.everyWeeks !== null && (
          <>
            <label>
              Abstand in Wochen
              <input
                type="number"
                required
                min="1"
                max="520"
                step="1"
                value={draft.everyWeeks || ''}
                onChange={(e) => update('everyWeeks', Number(e.target.value))}
              />
            </label>
            <label>
              Letzter Termin (optional)
              <input
                type="date"
                min={draft.startDay}
                value={draft.endDay || ''}
                onChange={(e) => update('endDay', e.target.value || null)}
              />
            </label>
          </>
        )}
        <label>
          Erinnerung
          <select
            value={draft.remindDays === null ? 'off' : 'on'}
            onChange={(e) => update('remindDays', e.target.value === 'on' ? 1 : null)}
          >
            <option value="on">Eingeschaltet</option>
            <option value="off">Ausgeschaltet</option>
          </select>
        </label>
        {draft.remindDays !== null && (
          <>
            <label>
              Tage vor dem Termin
              <input
                type="number"
                min="0"
                max="365"
                required
                value={draft.remindDays}
                onChange={(e) => update('remindDays', Number(e.target.value))}
              />
            </label>
            <label>
              Uhrzeit (Berlin)
              <input
                type="time"
                required
                value={draft.remindTime}
                onChange={(e) => update('remindTime', e.target.value)}
              />
            </label>
            <label>
              Wen erinnern?
              <select
                value={draft.profileIds.length === 2 ? 'both' : draft.profileIds[0]}
                onChange={(e) =>
                  update(
                    'profileIds',
                    e.target.value === 'both'
                      ? ['karla', 'marvin']
                      : [e.target.value === 'karla' ? 'karla' : 'marvin'],
                  )
                }
              >
                <option value="both">Karla und Marvin</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {changedAuthor && (
          <button type="button" className="button secondary" onClick={() => setAuthor(session)}>
            Als {profiles.find((p) => p.id === session.profileId)?.name} weiterbearbeiten
          </button>
        )}
        <div className="action-wrap">
          <button className="button primary" disabled={busy || changedAuthor}>
            Speichern
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  );
}

interface OccurrenceProps {
  item: Occurrence;
  session: Session;
  busy: boolean;
  act: (item: Occurrence, action: Action, day?: string) => Promise<boolean>;
}
/** Bietet gemeinsame Aktionen für genau einen Serientag an, einschließlich Verschieben und Einkaufsübernahme. */
function OccurrenceRow({ item, session, busy, act }: OccurrenceProps) {
  const [move, setMove] = useState<{ day: string; author: Session; occurrence: Occurrence } | null>(
    null,
  );
  const status = item.exception?.status || 'open';
  const person = profiles.find((p) => p.id === item.exception?.updatedBy)?.name;
  /** Verwendet beim Verschieben den angezeigten Versionsstand und die Person beim Öffnen des Datumsfelds. */
  async function moveOccurrence(event: FormEvent) {
    event.preventDefault();
    if (!move || !hasSameAuthorContext(move.author, session)) return;
    if (await act(move.occurrence, 'move', move.day)) setMove(null);
  }
  return (
    <article className="detail-list-item">
      <strong>{item.series.title}</strong>
      <p className="subtle">
        <time dateTime={item.day}>{dayLabel(item.day)}</time>
        {' · '}
        {calendarKinds[item.series.kind]}
        {item.originalDay !== item.day && ' · Verschoben vom ' + dayLabel(item.originalDay)}
        {status === 'done' && ' · Abgehakt'}
        {status === 'skipped' && ' · Ausgelassen'}
        {status !== 'open' && person && ' · ' + person}
      </p>
      {item.exception?.shoppingId && (
        <a className="text-link" href="#/shopping">
          Zur Einkaufsliste
        </a>
      )}
      <div className="action-wrap">
        {status === 'open' ? (
          <>
            {item.series.kind === 'household' && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void act(item, 'shopping')}
              >
                Auf die Einkaufsliste
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void act(item, 'done')}
            >
              Abhaken
            </button>
            <button
              className="button text-button"
              disabled={busy}
              onClick={() => setMove({ day: item.day, author: session, occurrence: item })}
            >
              Verschieben
            </button>
            <button
              className="button text-button"
              disabled={busy}
              onClick={() => void act(item, 'skip')}
            >
              Auslassen
            </button>
          </>
        ) : (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void act(item, 'reopen')}
          >
            Wieder öffnen
          </button>
        )}
      </div>
      {move && status === 'open' && (
        <form className="action-wrap" onSubmit={moveOccurrence}>
          <label>
            Neuer Termin
            <input
              type="date"
              required
              min="1900-01-01"
              value={move.day}
              onChange={(e) => setMove({ ...move, day: e.target.value })}
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !hasSameAuthorContext(move.author, session)}
          >
            Datum übernehmen
          </button>
          <button className="button text-button" type="button" onClick={() => setMove(null)}>
            Abbrechen
          </button>
        </form>
      )}
    </article>
  );
}

/** Zeigt offene Erinnerungen unabhängig vom Monat, eine Monatsagenda sowie die gemeinsamen Serieneinstellungen. */
export default function Calendar({ session, refresh, notify }: FeatureProps) {
  const [data, setData] = useState<CalendarData | null>(null);
  const [month, setMonth] = useState(() => localDay().slice(0, 7));
  const [upcoming, setUpcoming] = useState(false);
  const [form, setForm] = useState<OpenCalendarForm | null>(() =>
    window.location.hash === '#/calendar/household'
      ? { key: crypto.randomUUID(), initial: householdDraft() }
      : null,
  );
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => new Date());
  const [reminderLimit, setReminderLimit] = useState(10);
  const [showArchive, setShowArchive] = useState(false);
  const requestSequence = useRef(0);
  /** Holt den gemeinsam gespeicherten Stand und schützt ihn vor überholenden älteren Antworten. */
  const load = useCallback(async () => {
    const seq = ++requestSequence.current;
    try {
      const next = await api<CalendarData>('/calendar');
      if (seq === requestSequence.current) {
        setData(next);
        setClock(new Date());
      }
    } catch (err) {
      if (seq === requestSequence.current)
        setError(err instanceof Error ? err.message : 'Der Kalender konnte nicht geladen werden.');
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    window.addEventListener('focus', load);
    return () => {
      requestSequence.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [load, session.profileVersion, session.csrfToken]);
  useEffect(() => {
    /** Öffnet einen aus dem Einkaufsbereich angeforderten Entwurf auch bei einem reinen Hashwechsel. */
    function openHouseholdDraft() {
      if (window.location.hash === '#/calendar/household')
        setForm({ key: crypto.randomUUID(), initial: householdDraft() });
    }
    window.addEventListener('hashchange', openHouseholdDraft);
    return () => window.removeEventListener('hashchange', openHouseholdDraft);
  }, []);
  /** Schreibt konfliktgeprüft und lädt den gemeinsamen Kalender anschließend vom Server. */
  async function write(
    path: string,
    method: string,
    body: object,
    author: Session = session,
    updateShopping = false,
  ): Promise<boolean> {
    if (saving.current || !hasSameAuthorContext(author, session)) return false;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await api(path, {
        method,
        body: { ...body, profileVersion: author.profileVersion },
        session: author,
      });
      await load();
      if (updateShopping) await refresh();
      return true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Der Kalendereintrag konnte nicht gespeichert werden.',
      );
      if (err instanceof ApiError && [401, 403, 409].includes(err.status))
        await Promise.all([load(), refresh()]);
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  /** Sendet die bearbeitete Serie mit der ursprünglich gesehenen Version oder legt einen neuen Termin wiederholbar an. */
  async function save(value: CalendarFields, author: Session, requestId: string): Promise<boolean> {
    if (!form) return false;
    const saved = form.series
      ? await write(
          '/calendar/' + form.series.id,
          'PATCH',
          { ...value, version: form.series.version },
          author,
        )
      : await write('/calendar', 'POST', { ...value, requestId }, author);
    if (saved) {
      setMonth(value.startDay.slice(0, 7));
      notify('Kalendereintrag gespeichert.');
    }
    return saved;
  }
  /** Bestätigt die Änderung eines konkreten Serientermins und aktualisiert bei Bedarf auch die Einkaufsliste. */
  async function act(item: Occurrence, action: Action, day?: string): Promise<boolean> {
    const saved = await write(
      '/calendar/' + item.series.id + '/occurrences/' + item.originalDay,
      'POST',
      {
        action,
        movedTo: day,
        version: item.exception?.version ?? 0,
        seriesVersion: item.series.version,
      },
      session,
      action === 'shopping',
    );
    if (saved)
      notify(action === 'shopping' ? 'Steht auf eurer Einkaufsliste.' : 'Termin aktualisiert.');
    return saved;
  }
  /** Übernimmt ausschließlich die Formularfelder der Serie, ohne interne Autor- und Versionswerte zu senden. */
  function edit(series: CalendarSeries) {
    const { title, kind, startDay, everyWeeks, endDay, remindDays, remindTime, profileIds } =
      series;
    setForm({
      key: crypto.randomUUID(),
      series,
      initial: { title, kind, startDay, everyWeeks, endDay, remindDays, remindTime, profileIds },
    });
    setError('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  const monthEnd = addDays(shiftMonth(month, 1) + '-01', -1);
  const today = localDay(clock);
  const agenda = useMemo(
    () =>
      data
        ? calendarOccurrences(
            data,
            upcoming ? today : month + '-01',
            upcoming ? addDays(today, 29) : monthEnd,
          )
        : [],
    [data, upcoming, today, month, monthEnd],
  );
  const reminders = useMemo(
    () => (data && session.profileId ? openCalendarReminders(data, session.profileId, clock) : []),
    [data, session.profileId, clock],
  );
  return (
    <>
      <header className="page-heading">
        <h1>Kalender</h1>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => {
            setError('');
            setForm({
              key: crypto.randomUUID(),
              initial: blankCalendar(
                upcoming || month === today.slice(0, 7) ? today : month + '-01',
              ),
            });
          }}
        >
          Termin anlegen
        </button>
      </header>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {form && (
        <CalendarForm
          key={form.key}
          series={form.series}
          initial={form.initial}
          session={session}
          busy={busy}
          save={save}
          close={() => setForm(null)}
        />
      )}
      {!data && <p role="status">Kalender wird geladen …</p>}
      {data && (
        <>
          <section className="panel">
            <h2>
              Offene Erinnerungen für {profiles.find((p) => p.id === session.profileId)?.name}
            </h2>
            {reminders.length === 0 && <p>Alle Erinnerungen erledigt.</p>}
            {reminders.slice(0, reminderLimit).map((item) => (
              <OccurrenceRow
                key={item.series.id + item.originalDay}
                item={item}
                session={session}
                busy={busy}
                act={act}
              />
            ))}
            {reminders.length > reminderLimit && (
              <button
                className="button secondary"
                onClick={() => setReminderLimit(reminderLimit + 20)}
              >
                Weitere Erinnerungen anzeigen ({reminders.length - reminderLimit})
              </button>
            )}
          </section>
          <section className="panel">
            <h2>
              {upcoming
                ? 'Heute und die nächsten 29 Tage'
                : monthFormat.format(new Date(month + '-01T12:00:00Z'))}
            </h2>
            <div className="filter-bar">
              <button
                className="button secondary"
                aria-pressed={upcoming}
                onClick={() => setUpcoming(!upcoming)}
              >
                {upcoming ? 'Monatsansicht' : 'Heute und demnächst'}
              </button>
              {!upcoming && (
                <>
                  <button
                    className="button secondary"
                    disabled={month <= '1900-01'}
                    onClick={() => setMonth(shiftMonth(month, -1))}
                  >
                    Voriger Monat
                  </button>
                  <label>
                    Monat
                    <input
                      type="month"
                      min="1900-01"
                      max="9998-12"
                      value={month}
                      onChange={(e) => {
                        if (
                          /^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value) &&
                          e.target.value >= '1900-01' &&
                          e.target.value <= '9998-12'
                        )
                          setMonth(e.target.value);
                      }}
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={month >= '9998-12'}
                    onClick={() => setMonth(shiftMonth(month, 1))}
                  >
                    Nächster Monat
                  </button>
                  <button
                    className="button text-button"
                    onClick={() => setMonth(localDay().slice(0, 7))}
                  >
                    Dieser Monat
                  </button>
                </>
              )}
            </div>
            {agenda.length === 0 && <p>Für diesen Zeitraum sind keine Termine eingetragen.</p>}
            {agenda.map((item) => (
              <OccurrenceRow
                key={item.series.id + item.originalDay}
                item={item}
                busy={busy}
                session={session}
                act={act}
              />
            ))}
          </section>
          <section className="panel">
            <h2>Termine und Serien verwalten</h2>
            <button className="button text-button" onClick={() => setShowArchive(!showArchive)}>
              {showArchive ? 'Aktive Einträge anzeigen' : 'Archiv anzeigen'}
            </button>
            {data.series
              .filter((series) => !!series.archivedAt === showArchive)
              .map((series) => (
                <article className="detail-list-item" key={series.id}>
                  <strong>{series.title}</strong>
                  <p className="subtle">
                    {dayLabel(series.startDay)}
                    {' · '}
                    {series.everyWeeks === 1
                      ? 'Wöchentlich'
                      : series.everyWeeks
                        ? 'Alle ' + series.everyWeeks + ' Wochen'
                        : 'Einmalig'}
                    {series.endDay && ' bis ' + dayLabel(series.endDay)}
                    {' · angelegt von '}
                    {profiles.find((p) => p.id === series.createdBy)?.name}
                  </p>
                  <div className="action-wrap">
                    {!series.archivedAt && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => edit(series)}
                      >
                        Eintrag bearbeiten
                      </button>
                    )}
                    <button
                      className="button text-button"
                      disabled={busy}
                      onClick={() =>
                        void write('/calendar/' + series.id, 'PATCH', {
                          archived: !series.archivedAt,
                          version: series.version,
                        })
                      }
                    >
                      {series.archivedAt ? 'Wiederherstellen' : 'Archivieren'}
                    </button>
                  </div>
                </article>
              ))}
          </section>
        </>
      )}
      <PushSettings session={session} />
    </>
  );
}
