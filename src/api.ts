import type { Session } from '../shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code = '') { super(message); }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; session?: Session | null } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.session?.csrfToken ? { 'X-CSRF-Token': options.session.csrfToken } : {}) },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch { throw new ApiError('Keine Verbindung zu eurem Zuhause-PC. Deine Eingaben sind noch hier, aber nicht gespeichert.', 0, 'OFFLINE'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.message || 'Das hat gerade nicht geklappt. Bitte versuche es erneut.', response.status, data.code);
  return data as T;
}

export function photoUrl(id: string, variant = 'display') { return `/api/photos/${encodeURIComponent(id)}/file?variant=${variant}`; }

export function uploadPhoto(data: FormData, session: Session, onProgress: (percent: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos');
    if (session.csrfToken) xhr.setRequestHeader('X-CSRF-Token', session.csrfToken);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new ApiError('Die Verbindung wurde unterbrochen. Das Foto wurde nicht bestätigt.', 0, 'OFFLINE'));
    xhr.onload = () => {
      let result: any = {}; try { result = JSON.parse(xhr.responseText); } catch { /* handled by status */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else reject(new ApiError(result.message || 'Das Foto konnte nicht hochgeladen werden.', xhr.status, result.code));
    };
    xhr.send(data);
  });
}
