import { useEffect, useMemo, useState } from 'react';
import manual from '../../docs/podrecznik.md?raw';
import { renderBlocks, splitSections } from '../lib/markdown';
import { fold } from '../lib/format';

/** Odnośniki z podręcznika: kotwice → #pomoc/kotwica, reszta bez zmian. */
const linkFor = (href: string) => (href.startsWith('#') ? `#pomoc/${href.slice(1)}` : href);

/** Pomoc: podręcznik z docs/podrecznik.md – ten sam tekst co w repozytorium. */
export default function HelpView({ topic }: { topic: string }) {
  const sections = useMemo(() => splitSections(manual), []);
  const [query, setQuery] = useState('');
  const q = fold(query);
  const words = q.split(' ').filter(Boolean);
  const visible = words.length ? sections.filter((s) => words.every((w) => fold(s.text).includes(w))) : sections;

  // przejście do tematu (#pomoc/kotwica): rozwija sekcję i przewija do nagłówka
  const target = useMemo(
    () => sections.find((s) => s.slug === topic || s.subs.some((x) => x.slug === topic)),
    [sections, topic],
  );
  const [open, setOpen] = useState<Set<string>>(() => new Set(target ? [target.slug] : []));
  useEffect(() => {
    if (!target) return;
    setOpen((o) => new Set([...o, target.slug]));
    const t = setTimeout(() => document.getElementById(topic)?.scrollIntoView({ block: 'start' }), 50);
    return () => clearTimeout(t);
  }, [target, topic]);

  const toggle = (slug: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(slug)) n.delete(slug);
    else n.add(slug);
    return n;
  });
  const intro = sections.find((s) => !s.title);

  return (
    <div className="help">
      <header className="page-head">
        <h1>Pomoc</h1>
        {intro && renderBlocks(intro.lines, linkFor, 'intro')}
        <input type="search" className="search" placeholder="Szukaj w pomocy, np. sezonowość, VAT, skrzynka" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Szukaj w pomocy" />
      </header>
      {visible.filter((s) => s.title).length === 0 && <p className="muted">Nic nie znaleziono dla „{query}”.</p>}
      {visible.filter((s) => s.title).map((s) => {
        const isOpen = words.length > 0 || open.has(s.slug);
        return (
          <section key={s.slug} className={`help-section${isOpen ? ' open' : ''}`}>
            <h2 id={s.slug}>
              <button type="button" aria-expanded={isOpen} onClick={() => toggle(s.slug)}>
                <span>{s.title}</span>
                <span aria-hidden="true" className="chev">{isOpen ? '−' : '+'}</span>
              </button>
            </h2>
            {!isOpen && s.subs.length > 0 && <p className="muted small-text help-subs">{s.subs.map((x) => x.title).join(' · ')}</p>}
            {isOpen && <div className="md">{renderBlocks(s.lines, linkFor, s.slug)}</div>}
          </section>
        );
      })}
      <p className="muted small-text">
        Ten sam podręcznik i dokumentacja techniczna są w repozytorium:{' '}
        <a href="https://github.com/szymczyklp/budzet-domowy/tree/main/docs" target="_blank" rel="noopener noreferrer">github.com/szymczyklp/budzet-domowy/docs</a>.
      </p>
    </div>
  );
}

/** Mały odnośnik „?” do tematu pomocy – w nagłówkach ekranów. */
export function HelpLink({ topic, label = 'Pomoc' }: { topic: string; label?: string }) {
  return <a className="help-link" href={`#pomoc/${topic}`} aria-label={`${label} – pomoc`} title="Pomoc">?</a>;
}
