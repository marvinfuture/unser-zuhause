import { useEffect, useEffectEvent, useState } from 'react';
import type { Task } from '../shared/types';
import type { TaskHistoryPage } from '../shared/task-history';
import { api } from './api';

interface HistoryProps {
  task: Task;
  label: (field: string) => string;
  format: (field: keyof Task, value: unknown) => string;
}

/** Lädt neue Änderungen bis zur bekannten Version nach und behält bereits aufgeklappte ältere Seiten. */
export async function loadLatestHistory(
  readPage: (before?: number) => Promise<TaskHistoryPage>,
  known?: TaskHistoryPage,
): Promise<TaskHistoryPage> {
  let page = await readPage();
  const newestKnown = known?.entries[0]?.version;
  if (!known || newestKnown === undefined) return page;

  const additions = page.entries.filter((entry) => entry.version > newestKnown);
  // Nach längerer Abwesenheit können mehrere Seiten zwischen neuester und bekannter Änderung liegen.
  while (page.nextBefore !== null && page.nextBefore > newestKnown) {
    page = await readPage(page.nextBefore);
    additions.push(...page.entries.filter((entry) => entry.version > newestKnown));
  }
  return { ...known, partial: page.partial, entries: [...additions, ...known.entries] };
}

/** Hält den aufgeklappten Verlauf mit der gespeicherten Aufgabenversion synchron und lädt ältere Seiten auf Wunsch. */
export default function TaskHistory({ task, label, format }: HistoryProps) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [before, setBefore] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<{ version: number; page: TaskHistoryPage } | null>(null);
  const page = loaded?.page;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** Nach einem Fehler nutzt der Verlauf den nächsten erfolgreichen Haushaltsabruf für einen neuen Versuch. */
  const retryAfterRefresh = useEffectEvent(() => {
    if (open && error) setAttempt((value) => value + 1);
  });
  useEffect(() => {
    retryAfterRefresh();
  }, [task]);

  useEffect(() => {
    if (!open) return;
    const refresh = !loaded || loaded.version !== task.version;
    if (!refresh && (before === null || before !== loaded?.page.nextBefore)) return;
    const controller = new AbortController();
    setBusy(true);
    setError('');

    /** Liest eine Seite der aktuellen Aufgabe und bricht sie bei einem Wechsel des Anzeigestands ab. */
    function readPage(cursor?: number) {
      return api<TaskHistoryPage>(`/tasks/${task.id}/history${cursor ? '?before=' + cursor : ''}`, {
        signal: controller.signal,
      });
    }

    // Eine neue Version hat Vorrang. Eine gleichzeitig angeforderte ältere Seite folgt danach.
    const request =
      !refresh && before !== null
        ? readPage(before).then((older) => ({
            ...older,
            entries: [...loaded.page.entries, ...older.entries],
          }))
        : loadLatestHistory(readPage, loaded?.page);
    request
      .then((result) => {
        if (!controller.signal.aborted) setLoaded({ version: task.version, page: result });
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [open, task.id, task.version, loaded, before, attempt]);

  return (
    <details
      onToggle={(event) => {
        const expanded = event.currentTarget.open;
        setOpen(expanded);
        if (!expanded) {
          setBefore(null);
          setLoaded(null);
          setBusy(false);
          setError('');
        }
      }}
    >
      <summary>Bearbeitungsverlauf</summary>
      {page?.partial && (
        <p>
          Bei dieser älteren Aufgabe sind Ersteller und Erstellungszeit bekannt. Einzelne Änderungen
          werden seit dem Update aufgezeichnet.
        </p>
      )}
      {page?.entries.map((entry) => (
        <article key={entry.version} className="history-entry">
          <strong>
            {entry.actor === 'karla' ? 'Karla' : 'Marvin'} ·{' '}
            {entry.action === 'created' ? 'Aufgabe erstellt' : 'Aufgabe geändert'}
          </strong>
          <div>
            <time dateTime={entry.at}>
              {new Intl.DateTimeFormat('de-DE', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Europe/Berlin',
              }).format(new Date(entry.at))}
            </time>
          </div>
          {entry.changes.length > 0 && (
            <ul>
              {entry.changes.map((change) => (
                <li key={change.field}>
                  <strong>{label(change.field)}</strong>
                  {' · '}
                  {entry.action === 'changed' && (
                    <>{change.beforeLabel ?? format(change.field, change.before)} → </>
                  )}
                  {change.afterLabel ?? format(change.field, change.after)}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
      {busy && <p role="status">Verlauf wird geladen …</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            className="button secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Erneut laden
          </button>
        </p>
      )}
      {page?.nextBefore && !error && (
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => setBefore(page.nextBefore)}
        >
          Ältere Änderungen
        </button>
      )}
    </details>
  );
}
