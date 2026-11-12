import type { ReactNode } from 'react';

/**
 * Minimalny renderer Markdown dla podręcznika (docs/podrecznik.md): nagłówki #–###, akapity, listy
 * (także zagnieżdżone i numerowane), tabele, **pogrubienie**, `kod`, [odnośniki](...) i gołe adresy https.
 * Tworzy elementy React (bez wstawiania surowego HTML), więc treść nie może wstrzyknąć kodu.
 */

/** Kotwica nagłówka jak na GitHubie: małe litery, bez znaków interpunkcyjnych, spacje → myślniki. */
export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[`*]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

export interface MdSection {
  /** Tytuł nagłówka ## (pusty dla wstępu przed pierwszym ##). */
  title: string;
  slug: string;
  /** Podnagłówki ###. */
  subs: { title: string; slug: string }[];
  /** Surowy tekst sekcji (do wyszukiwania). */
  text: string;
  lines: string[];
}

/** Dzieli dokument na sekcje według nagłówków ##. Nagłówek # (tytuł dokumentu) jest pomijany. */
export const splitSections = (md: string): MdSection[] => {
  const out: MdSection[] = [];
  let cur: MdSection = { title: '', slug: '', subs: [], text: '', lines: [] };
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    if (/^# /.test(line)) continue;
    const h2 = line.match(/^## (.+)$/);
    if (h2) {
      out.push(cur);
      cur = { title: h2[1].trim(), slug: slugify(h2[1]), subs: [], text: '', lines: [] };
      continue;
    }
    const h3 = line.match(/^### (.+)$/);
    if (h3) cur.subs.push({ title: h3[1].trim(), slug: slugify(h3[1]) });
    cur.lines.push(line);
  }
  out.push(cur);
  for (const s of out) s.text = [s.title, ...s.lines].join('\n');
  return out.filter((s) => s.title || s.lines.some((l) => l.trim()));
};

/* ---------- elementy w linii ---------- */

const INLINE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(https?:\/\/[^\s)<]+[^\s).,;:!?<"'])/g;

export const inline = (text: string, linkFor: (href: string) => string, key = 'i'): ReactNode[] => {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], linkFor, k)}</strong>);
    else if (m[4] !== undefined) out.push(<code key={k}>{m[4]}</code>);
    else if (m[6] !== undefined) {
      // tylko bezpieczne adresy: https, kotwice i względne pliki – nigdy javascript: ani data:
      const raw = linkFor(m[7]);
      const href = /^(https?:\/\/|#|\.{0,2}\/|[\w-]+\.md)/.test(raw) ? raw : '#';
      const external = /^https?:/.test(href);
      out.push(
        <a key={k} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {inline(m[6], linkFor, k)}
        </a>,
      );
    } else if (m[8] !== undefined) {
      out.push(<a key={k} href={m[8]} target="_blank" rel="noopener noreferrer">{m[8]}</a>);
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

/* ---------- bloki ---------- */

interface ListItem { text: string; children: ListBlock | null }
interface ListBlock { ordered: boolean; items: ListItem[] }

const indentOf = (s: string) => s.match(/^ */)![0].length;
const listMark = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

/** Parsuje listę od wiersza `i`; zwraca blok i indeks pierwszego wiersza po liście. */
const parseList = (lines: string[], i: number, base: number): [ListBlock, number] => {
  const first = lines[i].match(listMark)!;
  const block: ListBlock = { ordered: /\d/.test(first[2]), items: [] };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // pusta linia kończy listę, chyba że dalej jest kolejny element na tym samym poziomie
      const next = lines[i + 1];
      if (next && listMark.test(next) && indentOf(next) === base) { i++; continue; }
      break;
    }
    const m = line.match(listMark);
    const ind = indentOf(line);
    if (m && ind === base) {
      block.items.push({ text: m[3], children: null });
      i++;
    } else if (m && ind > base && block.items.length) {
      const [child, next] = parseList(lines, i, ind);
      block.items[block.items.length - 1].children = child;
      i = next;
    } else if (!m && ind > base && block.items.length) {
      // kontynuacja tekstu elementu (wcięta linia)
      block.items[block.items.length - 1].text += ` ${line.trim()}`;
      i++;
    } else break;
  }
  return [block, i];
};

const renderList = (b: ListBlock, linkFor: (h: string) => string, key: string): ReactNode => {
  const items = b.items.map((it, j) => (
    <li key={`${key}-${j}`}>
      {inline(it.text, linkFor, `${key}-${j}`)}
      {it.children && renderList(it.children, linkFor, `${key}-${j}c`)}
    </li>
  ));
  return b.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
};

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** Renderuje linie Markdown (bez nagłówków ##) do elementów React. */
export const renderBlocks = (lines: string[], linkFor: (href: string) => string, key = 'b'): ReactNode[] => {
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `${key}-${n++}`;
    if (!line.trim()) { i++; continue; }
    const h = line.match(/^(#{3,4}) (.+)$/);
    if (h) {
      const Tag = h[1].length === 3 ? 'h3' : 'h4';
      out.push(<Tag key={k} id={slugify(h[2])}>{inline(h[2], linkFor, k)}</Tag>);
      i++;
      continue;
    }
    if (listMark.test(line)) {
      const [block, next] = parseList(lines, i, indentOf(line));
      out.push(renderList(block, linkFor, k));
      i = next;
      continue;
    }
    if (line.trim().startsWith('|') && lines[i + 1]?.trim().match(/^\|?\s*:?-+/)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(
        <div className="table-wrap" key={k}>
          <table className="md-table">
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, linkFor, `${k}h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, linkFor, `${k}r${ri}${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    // akapit: kolejne niepuste linie, które nie zaczynają innego bloku
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !listMark.test(lines[i]) && !/^#{2,4} /.test(lines[i]) && !lines[i].trim().startsWith('|')) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(<p key={k}>{inline(para.join(' '), linkFor, k)}</p>);
  }
  return out;
};
