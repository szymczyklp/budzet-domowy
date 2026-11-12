import { describe, expect, it } from 'vitest';
import { slugify } from './markdown';

/** Spójność dokumentacji: odnośniki „?” z ekranów i odnośniki między dokumentami muszą trafiać w istniejące nagłówki. */

const docs = import.meta.glob('../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const readme = import.meta.glob('../../README.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const views = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const anchors = (md: string) => new Set([...md.matchAll(/^#{1,4}\s+(.+)$/gm)].map((m) => slugify(m[1])));
const docByName = (name: string) => docs[`../../docs/${name}`];

describe('dokumentacja', () => {
  const manualAnchors = anchors(docByName('podrecznik.md'));

  it('odnośniki pomocy z ekranów prowadzą do istniejących tematów podręcznika', () => {
    const topics = Object.values(views).flatMap((src) => [...src.matchAll(/HelpLink topic="([^"]+)"/g)].map((m) => m[1]));
    expect(topics.length).toBeGreaterThan(5);
    expect(topics.filter((t) => !manualAnchors.has(t))).toEqual([]);
  });

  it('odnośniki w dokumentach i README prowadzą do istniejących plików i nagłówków', () => {
    const broken: string[] = [];
    const all: [string, string, 'docs' | 'root'][] = [
      ...Object.entries(docs).map(([k, v]) => [k, v, 'docs'] as [string, string, 'docs']),
      ...Object.entries(readme).map(([k, v]) => [k, v, 'root'] as [string, string, 'root']),
    ];
    for (const [name, text, base] of all) {
      for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = m[1];
        if (/^(https?:|mailto:)/.test(href)) continue;
        const [file, anchor] = href.split('#');
        let body: string | undefined = text;
        if (file) {
          const rel = base === 'root' ? file.replace(/^docs\//, '') : file;
          if (base === 'root' && !file.startsWith('docs/')) continue; // pliki spoza docs (np. worker/) – pomijamy
          body = file.endsWith('/') ? '' : docByName(rel);
        }
        if (body === undefined) broken.push(`${name}: ${href} (brak pliku)`);
        else if (anchor && !anchors(body).has(decodeURIComponent(anchor))) broken.push(`${name}: ${href}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
