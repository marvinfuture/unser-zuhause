import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Reward, RewardState } from '../shared/rewards';
import type { Session } from '../shared/types';
import type { FeatureProps } from './feature-props';
import { api, ApiError, hasSameAuthorContext } from './api';

type RewardAction = 'configure' | 'create' | 'edit' | 'redeem';
interface RewardDraft {
  action: RewardAction;
  reward?: Reward;
  author: Session;
  settingsVersion: number;
  enabled: boolean;
  title: string;
  cost: string;
  archived: boolean;
  requestId: string;
}
const profileNames = { karla: 'Karla', marvin: 'Marvin' };
const actionLabels = {
  configure: 'Punktefunktion ändern',
  create: 'Belohnung anlegen',
  edit: 'Belohnung bearbeiten',
  redeem: 'Belohnung einlösen',
};

/** Formatiert Guthaben und Preise mit passender Einzahl oder Mehrzahl. */
function pointsText(points: number) {
  return `${points} ${Math.abs(points) === 1 ? 'Punkt' : 'Punkte'}`;
}

/** Verwaltet die persönlichen Guthaben, den gemeinsamen Katalog und die bestätigte Einlösung unter dem gewählten Profil. */
export default function Rewards({ state, session, refresh, notify }: FeatureProps) {
  const [account, setAccount] = useState<RewardState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<RewardDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const generation = useRef(0);
  const switched = draft ? !hasSameAuthorContext(draft.author, session) : false;

  // Das Haushalts-Polling liefert auch nach Änderungen des zweiten Geräts regelmäßig einen neuen Datenstand.
  useEffect(() => {
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    void api<RewardState>('/rewards', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted && generation.current === currentGeneration) {
          setAccount(result);
          setLoadError('');
        }
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted && generation.current === currentGeneration)
          setLoadError(reason.message);
      });
    return () => controller.abort();
  }, [state, session.csrfToken, session.profileVersion]);

  useEffect(() => {
    formRef.current?.focus();
  }, [draft?.requestId]);

  /** Öffnet eine Aktion mit fester Anfragekennung, dem aktuellen Profil und dem angezeigten Katalogstand. */
  function open(action: RewardAction, reward?: Reward) {
    if (!account || busy) return;
    setError('');
    setUncertain(false);
    setDraft({
      action,
      reward,
      author: session,
      requestId: crypto.randomUUID(),
      settingsVersion: account.version,
      enabled: !account.enabled,
      title: reward?.title ?? '',
      cost: String(reward?.cost ?? 1),
      archived: !!reward?.archivedAt,
    });
  }

  /** Sendet die bestätigte Aktion mit ihrem ursprünglichen Autor und behält bei Verbindungsabbruch die Anfragekennung. */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy || switched) return;
    const { action, reward, author, requestId, settingsVersion, title, cost, enabled, archived } =
      draft;
    const body = {
      action,
      requestId,
      settingsVersion,
      profileVersion: author.profileVersion,
      ...(reward ? { id: reward.id, version: reward.version } : {}),
      ...(action === 'configure' ? { enabled } : {}),
      ...(action === 'create' || action === 'edit' ? { title, cost: Number(cost) } : {}),
      ...(action === 'edit' ? { archived } : {}),
    };
    setBusy(true);
    setError('');
    try {
      const result = await api<RewardState>('/rewards', { method: 'POST', body, session: author });
      generation.current++;
      setAccount(result);
      setLoadError('');
      setDraft(null);
      setUncertain(false);
      notify(action === 'redeem' ? 'Belohnung eingelöst.' : 'Gespeichert.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Die Änderung konnte nicht bestätigt werden.',
      );
      setUncertain(reason instanceof ApiError && (reason.status === 0 || reason.status >= 500));
      if (reason instanceof ApiError && [401, 403, 409].includes(reason.status)) await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <header className="page-heading">
        <div>
          <h1>Punkte &amp; Belohnungen</h1>
        </div>
      </header>
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}{' '}
          <button className="text-link" onClick={() => void refresh()}>
            Erneut laden
          </button>
        </p>
      )}
      {!account && !loadError && <p role="status">Punktestand wird geladen …</p>}
      {draft && (
        <form
          ref={formRef}
          tabIndex={-1}
          className="panel"
          aria-label={actionLabels[draft.action]}
          onSubmit={submit}
        >
          <h2>{actionLabels[draft.action]}</h2>
          {draft.action === 'configure' && (
            <p>
              {draft.enabled
                ? 'Beim Abhaken erhält die Person am Gerät einen Punkt für jede erstmals gewertete Aufgabe.'
                : 'Punkte sammeln und Einlösen pausieren? Bisherige Guthaben und Belohnungen bleiben gespeichert.'}
            </p>
          )}
          {draft.action === 'redeem' && draft.reward && (
            <p>
              „{draft.reward.title}“ für {pointsText(draft.reward.cost)} vom Guthaben von{' '}
              {profileNames[draft.author.profileId!]} einlösen?
            </p>
          )}
          {(draft.action === 'create' || draft.action === 'edit') && (
            <fieldset disabled={busy || switched || uncertain}>
              <label>
                Name der Belohnung{' '}
                <input
                  required
                  maxLength={160}
                  placeholder="Zum Beispiel gemeinsamer Kinoabend"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>
              <label>
                Preis in Punkten{' '}
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={1_000_000}
                  step={1}
                  required
                  value={draft.cost}
                  onChange={(e) => setDraft({ ...draft, cost: e.target.value })}
                />
              </label>
              {draft.action === 'edit' && (
                <label>
                  <input
                    type="checkbox"
                    checked={draft.archived}
                    onChange={(e) => setDraft({ ...draft, archived: e.target.checked })}
                  />{' '}
                  Im Archiv ablegen
                </label>
              )}
            </fieldset>
          )}
          {switched && (
            <p className="form-error" role="alert">
              Das Profil wurde gewechselt. Bitte öffne die gewünschte Aktion unter deinem Namen
              erneut.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {uncertain && <p>Wiederhole dieselbe Anfrage, um das Ergebnis zu bestätigen.</p>}
          <div className="action-wrap">
            <button className="button primary" disabled={busy || switched}>
              {busy
                ? 'Wird gespeichert …'
                : uncertain
                  ? 'Erneut senden'
                  : draft.action === 'redeem'
                    ? 'Jetzt einlösen'
                    : draft.action === 'configure'
                      ? draft.enabled
                        ? 'Einschalten'
                        : 'Pausieren'
                      : 'Speichern'}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Schließen
            </button>
          </div>
        </form>
      )}
      {account && (
        <>
          <section className="panel">
            <h2>Eure Guthaben</h2>
            <p>
              Karla · <strong>{pointsText(account.balances.karla)}</strong> &nbsp; Marvin ·{' '}
              <strong>{pointsText(account.balances.marvin)}</strong>
            </p>
            <p>
              {account.enabled
                ? 'Jede erledigte Aufgabe bringt der Person, die sie abhakt, einmalig einen Punkt. Beim Wiederöffnen bleibt der verdiente Punkt erhalten.'
                : 'Das Punktesammeln ist ausgeschaltet. Ihr könnt es gemeinsam für dieses Zuhause einschalten.'}
            </p>
            <button
              className="button secondary"
              disabled={!!draft}
              onClick={() => open('configure')}
            >
              {account.enabled ? 'Punkte pausieren' : 'Punkte einschalten'}
            </button>
          </section>
          {(account.enabled || account.rewards.length > 0) && (
            <section className="panel">
              <h2>Eure Belohnungen</h2>
              {account.enabled && (
                <button
                  className="button secondary"
                  disabled={!!draft}
                  onClick={() => open('create')}
                >
                  Belohnung anlegen
                </button>
              )}
              {account.rewards.length === 0 && (
                <p>
                  Legt fest, wofür ihr eure Punkte einlösen möchtet und wie viele Punkte es kostet.
                </p>
              )}
              <ul>
                {account.rewards.map((reward) => (
                  <li key={reward.id}>
                    <strong>{reward.title}</strong> · {pointsText(reward.cost)}
                    {reward.archivedAt && ' · Archiviert'}
                    {account.enabled && (
                      <div className="action-wrap">
                        {!reward.archivedAt && (
                          <button
                            className="button secondary"
                            disabled={
                              !!draft ||
                              !session.profileId ||
                              account.balances[session.profileId] < reward.cost
                            }
                            onClick={() => open('redeem', reward)}
                          >
                            Einlösen
                          </button>
                        )}
                        <button
                          className="text-link"
                          disabled={!!draft}
                          onClick={() => open('edit', reward)}
                        >
                          Bearbeiten
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {account.recent.length > 0 && (
            <section className="panel">
              <h2>Letzte Buchungen</h2>
              <ol>
                {account.recent.map((entry) => (
                  <li key={entry.id}>
                    <strong>{profileNames[entry.createdBy]}</strong> · {entry.points > 0 ? '+' : ''}
                    {pointsText(entry.points)} · {entry.title} ·{' '}
                    <time dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleString('de-DE', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: 'Europe/Berlin',
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );
}
