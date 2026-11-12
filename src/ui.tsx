import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { money } from './lib/format';

export function Money({ value, strong }: { value: number; strong?: boolean }) {
  const cls = value > 0 ? 'money in' : value < 0 ? 'money out' : 'money zero';
  return <span className={strong ? `${cls} strong` : cls}>{money(value)}</span>;
}

/** Panel wysuwany od dołu (na telefonie) / okno (na komputerze). */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className="sheet" onCancel={onClose} aria-label={title}>
      <header className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="ghost" onClick={onClose}>Zamknij</button>
      </header>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function CopyButton({ text, label = 'Kopiuj' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.replace(/\s/g, ''));
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      window.prompt('Skopiuj ręcznie:', text);
    }
  };
  return (
    <button type="button" className="small" onClick={copy}>
      {done ? 'Skopiowano' : label}
    </button>
  );
}
