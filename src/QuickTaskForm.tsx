import { useRef, useState, type FormEvent } from 'react';
import type { Project, Session, Task } from '../shared/types';
import { api, hasSameAuthorContext } from './api';

interface QuickTaskProps {
  session: Session;
  refresh: () => Promise<void>;
  project?: Project;
  phase?: Task['phase'];
}

/** Erfasst einen kleinen Arbeitsschritt als reguläre Aufgabe und erhält den Entwurf bei einem Speicherfehler. */
export default function QuickTaskForm({ session, refresh, project, phase }: QuickTaskProps) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState(session);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const changedProfile = !!title && !hasSameAuthorContext(author, session);

  /** Eine wiederholte Übermittlung mit demselben Inhalt erzeugt genau eine Aufgabe. */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy || changedProfile) return;
    const fields = {
      title: title.trim(),
      projectId: project?.id ?? null,
      roomId: project?.roomId ?? null,
      phase: phase ?? 'preparation',
    };
    const fingerprint = JSON.stringify([
      fields,
      author.profileId,
      author.profileVersion,
      author.csrfToken,
    ]);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, id: crypto.randomUUID() };
    setError('');
    setBusy(true);
    try {
      await api('/tasks', {
        method: 'POST',
        session: author,
        body: { ...fields, requestId: attempt.current.id, profileVersion: author.profileVersion },
      });
      attempt.current = null;
      setTitle('');
      await refresh();
      input.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="quick-task">
      <label>
        {project ? 'Kleinen Projektschritt anlegen' : 'Neue Alltagserledigung'}
        <input
          ref={input}
          required
          maxLength={160}
          disabled={busy}
          value={title}
          placeholder={project ? 'z. B. Fußleisten abkleben' : 'z. B. Glaser anrufen'}
          onChange={(event) => {
            if (!title) setAuthor(session);
            setTitle(event.target.value);
          }}
        />
      </label>
      <button className="button primary" disabled={busy || !title.trim() || changedProfile}>
        Hinzufügen
      </button>
      {changedProfile && (
        <button type="button" className="button secondary" onClick={() => setAuthor(session)}>
          Als {session.profileId === 'karla' ? 'Karla' : 'Marvin'} übernehmen
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </form>
  );
}
