import { Component } from 'react';
import type { ReactNode } from 'react';
import { idbGet } from './lib/idb';
import { downloadDoc } from './lib/backup';
import type { BudgetDoc } from './lib/types';

/**
 * Ostatnia linia obrony: błąd w którymś widoku (np. nieprzewidziany kształt danych) nie zostawia pustego ekranu.
 * Dane zostają w przeglądarce i na Dysku – można pobrać kopię i wrócić do aplikacji.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Błąd aplikacji', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const backup = async () => {
      const doc = await idbGet<BudgetDoc>('doc').catch(() => undefined);
      if (doc) downloadDoc(doc);
    };
    return (
      <main className="page">
        <section className="panel" role="alert">
          <h2>Coś poszło nie tak</h2>
          <p className="muted">Aplikacja trafiła na nieoczekiwany błąd. Twoje dane są nadal zapisane na tym urządzeniu{' '}
            (i na Dysku, jeśli jest połączony).</p>
          <p className="muted small-text">{String(this.state.error.message).slice(0, 300)}</p>
          <p className="row-actions">
            <button type="button" className="primary" onClick={() => { location.hash = ''; location.reload(); }}>Otwórz ponownie</button>
            <button type="button" onClick={() => void backup()}>Pobierz kopię danych</button>
          </p>
        </section>
      </main>
    );
  }
}
