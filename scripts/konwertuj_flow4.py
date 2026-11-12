"""
Jednorazowa konwersja arkusza flow4 (master_data2.xlsx) do pliku budzet.json,
który można zaimportować w aplikacji (Ustawienia → Wczytaj kopię).

Użycie:
    pip install openpyxl
    python scripts/konwertuj_flow4.py master_data2.xlsx --od 2026-11 -o data/budzet.json

Jak czytany jest arkusz:
- wiersz 2 zawiera miesiące, kolumna A nazwy, kolumna B dzień płatności,
- wiersze z ciemnym tłem (PRZYCHODY, KREDYTY, …) to kategorie,
- ciemniejszy odcień komórki = zapłacone, jaśniejszy = prognoza,
  szare wiersze = pozycje zamknięte.
- Miesiące przed --od trafiają do historii (wpisy z kwotą i statusem),
  od --od dalej powstają reguły prognozy (kwota obowiązuje do następnej zmiany).

UWAGA: wynikowy plik zawiera Twoje dane – nie commituj go do repozytorium
(katalog data/ jest w .gitignore).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

HEADER_FILLS = {"4F6128", "5F497A", "953734"}
PAID_FILLS = {"C2D69B", "B4A7D6", "E5B8B7", "E6B8AF"}
GRAY_FILLS = {"999999", "666666", "434343", "CCCCCC", "D9D9D9"}
SKIP_ROWS = {"DOCHODY", "WYPADKOWA"}
NO_DAY = {"---", "nd", "", "-"}


def fill_of(cell) -> str:
    f = cell.fill
    if f is None or f.fill_type is None:
        return ""
    rgb = f.fgColor.rgb if f.fgColor is not None and f.fgColor.type == "rgb" else ""
    return (rgb or "")[-6:].upper()


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.replace("ł", "l").replace("Ł", "L"))
    text = text.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "x"


def month_key(d: dt.datetime) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def unique(base: str, used: set[str]) -> str:
    key, n = base, 2
    while key in used:
        key, n = f"{base}-{n}", n + 1
    used.add(key)
    return key


def to_number(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    return None


def month_diff(a: str, b: str) -> int:
    """Liczba miesięcy od a do b."""
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:]) - int(a[5:])


def detect_period(series: list[tuple[str, float]]):
    """Jeśli w serii jest jedna niezerowa kwota co stałe N>1 miesięcy (min. 3 razy),
    zwraca (pierwszy_miesiąc, kwota, N); w przeciwnym razie None."""
    idx = [i for i, (_, v) in enumerate(series) if v != 0]
    if len(idx) < 3 or len({series[i][1] for i in idx}) != 1:
        return None
    steps = {b - a for a, b in zip(idx, idx[1:])}
    if len(steps) != 1 or (step := steps.pop()) < 2:
        return None
    return series[idx[0]][0], series[idx[0]][1], step


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx")
    ap.add_argument("--arkusz", default="flow4")
    ap.add_argument("--od", default=dt.date.today().strftime("%Y-%m"),
                    help="pierwszy miesiąc prognozy, RRRR-MM (domyślnie bieżący)")
    ap.add_argument("-o", "--wyjscie", default="data/budzet.json")
    ap.add_argument("--kto", default="import-flow4", help="wartość pola updatedBy")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}", args.od):
        ap.error("--od musi mieć format RRRR-MM")

    wb_val = openpyxl.load_workbook(args.xlsx, data_only=True)
    wb_fmt = openpyxl.load_workbook(args.xlsx)
    ws, wf = wb_val[args.arkusz], wb_fmt[args.arkusz]

    months = [(c.column, month_key(c.value)) for c in ws[2]
              if isinstance(c.value, dt.datetime)]
    if not months:
        print("Nie znalazłem miesięcy w wierszu 2.", file=sys.stderr)
        return 1
    last_month = months[-1][1]

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    meta = {"updatedAt": now, "updatedBy": args.kto}
    doc = {"schema": 1, "categories": {}, "accounts": {}, "positions": {}, "entries": {}}
    used_ids: set[str] = set()
    account_by_name: dict[str, str] = {}

    def category(name: str) -> str:
        cid = "c-" + slug(name)
        if cid not in doc["categories"]:
            doc["categories"][cid] = {"id": cid, "name": name,
                                      "order": len(doc["categories"]), **meta}
        return cid

    def account(name: str) -> str:
        name = name.replace("\\", "").strip()
        if name not in account_by_name:
            aid = unique("a-" + slug(name), used_ids)
            doc["accounts"][aid] = {"id": aid, "name": name,
                                    "kind": "karta" if "*" in name else "inne", **meta}
            account_by_name[name] = aid
        return account_by_name[name]

    current_cat: str | None = None
    skipped = 0

    for r in range(3, ws.max_row + 1):
        label = ws.cell(r, 1).value
        first_fill = fill_of(wf.cell(r, months[0][0]))
        if not isinstance(label, str) or not label.strip():
            continue
        label = label.strip()
        if label in SKIP_ROWS:
            current_cat = None
            continue
        if first_fill in HEADER_FILLS:
            current_cat = category(label)
            continue

        cat_id = current_cat or category("POZOSTAŁE")

        # wartości i kolory po miesiącach
        values: dict[str, float | None] = {}
        fills: dict[str, str] = {}
        for col, m in months:
            values[m] = to_number(ws.cell(r, col).value)
            fills[m] = fill_of(wf.cell(r, col))
        present = [m for _, m in months if values[m] is not None]
        if not present:
            skipped += 1
            continue

        # nazwa, konto z [nawiasu], numer z (nawiasu)
        name = label.replace("\\", "")
        acc_id = None
        mb = re.search(r"\[([^\]]+)\]", name)
        if mb:
            acc_id = account(mb.group(1))
            name = (name[:mb.start()] + name[mb.end():]).strip()
        ref = None
        mp = re.search(r"\((\d{6,})\)", name)
        if mp:
            ref = mp.group(1)

        # kolumna B: dzień płatności albo podpowiedź
        b = ws.cell(r, 2).value
        day, note = None, None
        if isinstance(b, (int, float)) and 1 <= int(b) <= 31:
            day = int(b)
        elif isinstance(b, str) and b.strip().isdigit() and 1 <= int(b) <= 31:
            day = int(b)
        elif isinstance(b, dt.datetime):
            note = f"Odnowienie: {b.month:02d}.{b.year}"
        elif isinstance(b, str) and b.strip() not in NO_DAY:
            acc_id = acc_id or account(b.strip())

        nonzero = [m for m in present if values[m] != 0]
        active_from = present[0]
        active_to = nonzero[-1] if nonzero else present[-1]
        tail = [values[m] for _, m in months[-6:]]
        if active_to == last_month and len(set(tail)) == 1 and tail[0] not in (None, 0):
            active_to = None  # stała płatność – prognoza bez końca

        # prognoza: płatność cykliczna co N miesięcy (np. prąd co 2 miesiące)?
        start = max(args.od, active_from)
        future = [(m, values[m] or 0.0) for _, m in months
                  if start <= m <= (active_to or last_month)]
        periodic = detect_period(future)
        if periodic and active_to and month_diff(active_to, last_month) < periodic[2]:
            active_to = None

        pid = unique("p-" + slug(name), used_ids)
        pos = {"id": pid, "name": name, "categoryId": cat_id, "activeFrom": active_from,
               "rules": [], **meta}
        if active_to:
            pos["activeTo"] = active_to
        for k, v in (("accountId", acc_id), ("day", day), ("reference", ref), ("note", note)):
            if v is not None:
                pos[k] = v

        # historia (przed --od) i zapłacone pozycje → wpisy
        for _, m in months:
            v = values[m]
            if v in (None, 0):
                continue
            paid = fills[m] in PAID_FILLS or (fills[m] in GRAY_FILLS and m < args.od)
            if m < args.od or paid:
                key = f"{pid}|{m}"
                doc["entries"][key] = {"positionId": pid, "month": m, "amount": v,
                                       "paid": paid, **meta}

        # prognoza (od --od) → reguły
        if periodic:
            first, amount, every = periodic
            pos["rules"].append({"from": first, "amount": amount, "everyMonths": every})
        else:
            prev = object()
            for m, v in future:  # kompresja jednakowych kwot
                if v != prev:
                    pos["rules"].append({"from": m, "amount": v})
                    prev = v

        doc["positions"][pid] = pos

    out = Path(args.wyjscie)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    paid = sum(1 for e in doc["entries"].values() if e["paid"])
    print(f"Zapisano {out}: {len(doc['categories'])} kategorii, {len(doc['positions'])} pozycji, "
          f"{len(doc['accounts'])} kont/kart, {len(doc['entries'])} wpisów ({paid} zapłaconych). "
          f"Pominięto puste wiersze: {skipped}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
