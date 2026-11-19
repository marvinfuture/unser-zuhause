import { useEffect, useState } from 'react';
import type { Session } from '../shared/types';
import { api } from './api';

type Setup = { publicKey: string; needsContact: boolean };
type DeviceStatus = { profile: 'karla' | 'marvin' | null; lastFailure: string | null };

/** Wandelt den öffentlichen VAPID-Schlüssel in das vom Browser benötigte Byteformat um. */
function applicationKey(encoded: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
}

/** Bindet die Geräteaktionen an die zuletzt bestätigte Person und verwirft Eingaben beim Profilwechsel. */
export default function PushSettings({ session }: { session: Session }) {
  return (
    <DeviceSettings key={session.csrfToken + ':' + session.profileVersion} session={session} />
  );
}

/** Prüft das aktuelle Browser-Abo und richtet den freiwilligen Empfang für genau dieses Gerät ein. */
function DeviceSettings({ session }: { session: Session }) {
  const [setup, setSetup] = useState<Setup>();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [device, setDevice] = useState<DeviceStatus>({ profile: null, lastFailure: null });
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const supported =
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  const blocked = supported && Notification.permission === 'denied';
  const actor = session.profileId === 'karla' ? 'Karla' : 'Marvin';
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    setSetup(undefined);
    // Wartet nur begrenzte Zeit auf den im App-Einstieg registrierten Service Worker.
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () =>
          reject(
            new Error(
              'Die Handy-Einrichtung konnte nicht geladen werden. Öffnet die App neu und versucht es erneut.',
            ),
          ),
        12000,
      );
    });
    (async () => {
      const [data, reg] = await Promise.all([
        api<Setup>('/push/setup'),
        Promise.race([navigator.serviceWorker.ready, timeout]),
      ]);
      const existing = await reg.pushManager.getSubscription();
      const status = existing
        ? await api<DeviceStatus>('/push/status', {
            method: 'POST',
            session,
            body: { endpoint: existing.endpoint, profileVersion: session.profileVersion },
          })
        : { profile: null, lastFailure: null };
      if (!cancelled) {
        setRegistration(reg);
        setSubscription(existing);
        setDevice(status);
        setSetup(data);
      }
    })()
      .catch((error: Error) => {
        if (!cancelled) setMessage(error.message);
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [supported, session.profileVersion, session.csrfToken, revision]);

  /** Fragt die Systemberechtigung direkt beim Antippen an und meldet das Gerät ausdrücklich für das gewählte Profil an. */
  async function activate(event: React.FormEvent) {
    event.preventDefault();
    if (!registration || !setup || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted')
        throw new Error(
          'Benachrichtigungen wurden nicht erlaubt. Die Berechtigung lässt sich in den Geräteeinstellungen ändern.',
        );
      const bytes = applicationKey(setup.publicKey);
      let current = await registration.pushManager.getSubscription();
      // Nach Serverwechsel, Wiederherstellung oder abgelaufenem Abo einen neuen Endpunkt beim Anbieter anfordern.
      if (current) {
        const previous = new Uint8Array(current.options.applicationServerKey ?? new ArrayBuffer(0));
        if (
          !device.profile ||
          previous.length !== bytes.length ||
          previous.some((value, index) => value !== bytes[index])
        ) {
          await current.unsubscribe();
          current = null;
        }
      }
      current ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
      });
      const result = await api<{ profile: DeviceStatus['profile'] }>('/push/subscribe', {
        method: 'POST',
        session,
        body: {
          profileVersion: session.profileVersion,
          subscription: current.toJSON(),
          ...(setup.needsContact ? { contactEmail: email } : {}),
        },
      });
      setSubscription(current);
      setDevice({ profile: result.profile, lastFailure: null });
      setSetup({ ...setup, needsContact: false });
      setEmail('');
      setMessage('Handy-Erinnerungen sind aktiviert.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Aktivierung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  /** Beendet die Zustellung auf dem Heim-PC und gibt anschließend auch die Browser-Anmeldung beim Pushdienst frei. */
  async function deactivate() {
    if (!subscription || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api('/push/unsubscribe', {
        method: 'POST',
        session,
        body: { endpoint: subscription.endpoint, profileVersion: session.profileVersion },
      });
      setDevice({ profile: null, lastFailure: null });
      await subscription.unsubscribe();
      setSubscription(null);
      setMessage('Handy-Erinnerungen sind auf diesem Gerät ausgeschaltet.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Abmeldung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  /** Fordert nach einem bewussten Tastendruck eine einzelne Testnachricht an und prüft anschließend den Gerätestatus. */
  async function testDelivery() {
    if (!subscription || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api('/push/test', {
        method: 'POST',
        session,
        body: { endpoint: subscription.endpoint, profileVersion: session.profileVersion },
      });
      setMessage(
        'Der Push-Dienst hat die Testnachricht angenommen. Prüfe die Mitteilungen auf diesem Gerät.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Versand fehlgeschlagen.');
      setRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Handy-Erinnerungen</h2>
      {!supported ? (
        <p>
          Öffne die App über HTTPS. Auf dem iPhone brauchst du iOS 16.4 oder neuer und die über den
          Home-Bildschirm geöffnete App.
        </p>
      ) : (
        <>
          {blocked && (
            <p>
              Mitteilungen sind auf diesem Gerät gesperrt. Du kannst sie in den
              Mitteilungseinstellungen erlauben.
            </p>
          )}
          {setup && (
            <>
              {device.profile && (
                <p>
                  Auf diesem Gerät kommen Erinnerungen für{' '}
                  <strong>{device.profile === 'karla' ? 'Karla' : 'Marvin'}</strong> an.
                </p>
              )}
              {device.lastFailure && (
                <p>
                  Der letzte Versand ist fehlgeschlagen. Der Heim-PC versucht die Zustellung
                  innerhalb des Erinnerungsfensters erneut.
                </p>
              )}
              {device.profile !== session.profileId && !blocked && (
                <form onSubmit={activate}>
                  <p>
                    Der Heim-PC sendet verschlüsselte Kalendererinnerungen über den Push-Dienst
                    dieses Geräts. Die Nachricht kann auf dem Sperrbildschirm erscheinen.
                  </p>
                  {setup.needsContact && (
                    <label>
                      Kontakt-E-Mail für den Push-Dienst
                      <input
                        required
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                      <small>
                        Einmal pro Haushalt. Der Anbieter erhält diese Adresse als technischen
                        Absenderkontakt.
                      </small>
                    </label>
                  )}
                  <button className="button secondary" disabled={busy} type="submit">
                    Für {actor} auf diesem Gerät aktivieren
                  </button>
                </form>
              )}
              {device.profile && (
                <div className="action-wrap">
                  {device.profile === session.profileId && !blocked && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy}
                      onClick={testDelivery}
                    >
                      Testnachricht senden
                    </button>
                  )}
                  <button
                    className="button text-button"
                    type="button"
                    disabled={busy}
                    onClick={deactivate}
                  >
                    Auf diesem Gerät ausschalten
                  </button>
                </div>
              )}
            </>
          )}
          {!setup && !message && <p>Geräteanmeldung wird geprüft …</p>}
          {!setup && message && (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setMessage('');
                setRevision((value) => value + 1);
              }}
            >
              Erneut prüfen
            </button>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
