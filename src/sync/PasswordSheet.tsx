import { useState } from 'react';
import { useSync } from './SyncProvider';
import { WrongPassword } from '../lib/crypto';
import { Sheet } from '../ui';

/**
 * Formularz hasła zgodny z menedżerami haseł (Bitdefender SecurePass, iCloud, 1Password):
 * prawdziwy <form>, ukryte pole użytkownika i autocomplete="current-password".
 */
export default function PasswordSheet({ onClose }: { onClose: () => void }) {
  const s = useSync();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      await s.unlock(password);
      onClose();
    } catch (err) {
      setError(err instanceof WrongPassword ? 'Złe hasło – spróbuj jeszcze raz.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Hasło do danych" onClose={onClose}>
      <form onSubmit={submit} className="password-form">
        <input type="text" name="username" autoComplete="username" value="Budżet domowy" readOnly className="visually-hidden" tabIndex={-1} aria-hidden="true" />
        <label className="field">
          <span className="field-label">Hasło</span>
          <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <span className="field-hint">Wklej z menedżera haseł. Hasło nie jest nigdzie zapisywane – urządzenie pamięta tylko klucz do odszyfrowania.</span>
        </label>
        {error && <p className="error">{error}</p>}
        <p className="row-actions">
          <button type="submit" className="primary" disabled={busy || !password}>{busy ? 'Sprawdzam…' : 'Odblokuj'}</button>
        </p>
      </form>
    </Sheet>
  );
}
