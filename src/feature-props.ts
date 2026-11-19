import type { AppState, Session } from '../shared/types';

/** Gemeinsamer Haushaltsstand und bestätigte Sitzung für die einzelnen Funktionsbereiche. */
export interface FeatureProps {
  session: Session;
  state: AppState;
  /** Lädt den gemeinsamen Datenstand nach einer bestätigten Änderung. */
  refresh: () => Promise<void>;
  /** Zeigt eine Erfolgsmeldung oder einen Fehler in der laufenden App. */
  notify: (message: string, error?: boolean) => void;
}
