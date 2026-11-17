import type { Session } from '../shared/types';

/** Transportiert neben der Meldung den HTTP-Status und den fachlichen Fehlercode zur Oberfläche. */
export class ApiError extends Error {
  /** Bewahrt den Serverstatus; Status 0 bezeichnet einen nicht bestätigten Netzwerkzugriff. */
  constructor(
    message: string,
    public status: number,
    public code = '',
  ) {
    super(message);
  }
}

/**
 * Führt einen JSON-Aufruf gegen die lokale API mit Haushaltssitzung und gegebenenfalls CSRF-Token aus.
 * Antworten werden nicht im Browsercache gespeichert. Netzwerk- und Serverfehler erhalten ein
 * einheitliches ApiError-Format, damit Formulare ihre Eingaben behalten und Konflikte erkennen können.
 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; session?: Session | null } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.session?.csrfToken ? { 'X-CSRF-Token': options.session.csrfToken } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(
      'Keine Verbindung zu eurem Zuhause-PC. Deine Eingaben sind noch hier, aber nicht gespeichert.',
      0,
      'OFFLINE',
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      data.message || 'Das hat gerade nicht geklappt. Bitte versuche es erneut.',
      response.status,
      data.code,
    );
  return data as T;
}

/**
 * Erstellt eine geschützte Medienadresse für Vorschau, Anzeige oder Original; die Sitzung prüft der
 * Server.
 */
export function photoUrl(id: string, variant = 'display') {
  return `/api/photos/${encodeURIComponent(id)}/file?variant=${variant}`;
}

/**
 * Überträgt genau ein Foto als Multipart-Anfrage. XMLHttpRequest wird hier für echte Upload-
 * Fortschrittsereignisse verwendet; erst eine erfolgreiche Serverantwort bestätigt die Speicherung.
 */
export function uploadPhoto(
  data: FormData,
  session: Session,
  onProgress: (percent: number) => void,
): Promise<unknown> {
  // Der Promise verbindet die ereignisbasierte Übertragung mit dem sequenziellen Uploadablauf der UI.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos');
    if (session.csrfToken) xhr.setRequestHeader('X-CSRF-Token', session.csrfToken);
    // Ohne bekannte Gesamtgröße wird kein irreführender Prozentwert aus einem Schätzwert erzeugt.
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    // Ein Verbindungsabbruch bestätigt weder Erfolg noch Scheitern auf dem Server; die Anfrage-ID erlaubt Wiederholung.
    xhr.onerror = () =>
      reject(
        new ApiError(
          'Die Verbindung wurde unterbrochen. Das Foto wurde nicht bestätigt.',
          0,
          'OFFLINE',
        ),
      );
    // Auch eine vollständig übertragene Datei kann bei Validierung oder Verarbeitung noch abgelehnt werden.
    xhr.onload = () => {
      let result: any = {};
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        /* Ohne JSON bleibt der HTTP-Status maßgeblich. */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else
        reject(
          new ApiError(
            result.message || 'Das Foto konnte nicht hochgeladen werden.',
            xhr.status,
            result.code,
          ),
        );
    };
    xhr.send(data);
  });
}
