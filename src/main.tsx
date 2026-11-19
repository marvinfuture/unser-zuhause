import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

/**
 * Fängt Renderfehler im Komponentenbaum ab und bietet einen Neustart der Ansicht statt einer leeren
 * Seite.
 */
class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  /** Schaltet nach einem von React abgefangenen Renderfehler dauerhaft auf die Ersatzansicht um. */
  static getDerivedStateFromError() {
    return { failed: true };
  }
  /** Zeigt entweder die eigentliche App oder die Fehlermeldung mit bewusst auslösbarem Neuladen. */
  render() {
    if (this.state.failed)
      return (
        <main className="fatal">
          <h1>Ein kleiner Stolperstein.</h1>
          <p>
            Die Ansicht konnte nicht geladen werden. Bereits gespeicherte Daten bleiben erhalten.
          </p>
          <button onClick={() => location.reload()} className="button primary">
            Ansicht neu laden
          </button>
        </main>
      );
    return this.props.children;
  }
}

// StrictMode prüft im Entwicklungsbetrieb unter anderem, ob Effekte ihre Ressourcen wieder freigeben.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && window.isSecureContext) {
  // Die optionale PWA-Registrierung wartet auf den Seitenaufbau und läuft nur in einem sicheren Kontext.
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
      /* Die Webapp bleibt auch ohne PWA-Installation nutzbar. */
    }),
  );
}
