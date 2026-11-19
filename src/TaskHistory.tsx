import { useEffect, useState } from 'react';
import type { Task } from '../shared/types';
import type { TaskHistoryPage, TaskRevision } from '../shared/task-history';
import { api } from './api';

interface HistoryProps {
  task: Task;
  label: (field: string) => string;
  format: (field: keyof Task, value: unknown) => string;
}

/** Lädt den aufgabenspezifischen Verlauf erst beim Aufklappen und ältere Änderungen bei Bedarf. */
export default function TaskHistory({ task, label, format }: HistoryProps) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [before, setBefore] = useState<number | null>(null);
  const [entries, setEntries] = useState<TaskRevision[]>([]);
  const [page, setPage] = useState<TaskHistoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setBusy(true);
    setError('');
    api<TaskHistoryPage>(`/tasks/${task.id}/history${before ? '?before=' + before : ''}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setEntries((old) => (before ? [...old, ...result.entries] : result.entries));
        setPage(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [open, task.id, before, attempt]);

  return (
    <details
      onToggle={(event) => {
        const expanded = event.currentTarget.open;
        setOpen(expanded);
        if (!expanded) {
          setBefore(null);
          setEntries([]);
          setPage(null);
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
      {entries.map((entry) => (
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
            onClick={() => setAttempt(attempt + 1)}
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
