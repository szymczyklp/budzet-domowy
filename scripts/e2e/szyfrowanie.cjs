/**
 * Test w przeglądarce: synchronizacja i szyfrowanie na dwóch „urządzeniach” z podstawionym Dyskiem Google
 * (żądania do googleapis.com przechwytuje Playwright – prawdziwe konto nie jest potrzebne).
 *
 * Uruchomienie:  npm run build && npx vite preview --port 4173 &   potem   node scripts/e2e/szyfrowanie.cjs
 * Wymaga pakietu `playwright` z Chromium (nie jest zależnością projektu – test nie działa w publikacji).
 * Sprawdza m.in.: włączenie hasła, drugie urządzenie, podmianę pliku na jawny, zmianę i wyłączenie hasła
 * przy równoczesnym zapisie drugiej osoby, uszkodzony plik na Dysku.
 */
const { chromium } = require('playwright');
const URL0 = process.argv[2] || 'http://localhost:4173/';
const drive = { text: null, version: 1, uploads: 0, snapshots: 0 };
const meta = () => ({ id: 'F', name: 'budzet-domowy.json', version: String(drive.version), ownedByMe: true, parents: ['P'], owners: [{ displayName: 'Jan Test', emailAddress: 'jan@example.com' }] });
const log = [];
const ok = (name, cond, extra = '') => { log.push(`${cond ? 'OK  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); };

async function device(browser, name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.accept());
  await ctx.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.endsWith('/about')) return json({ user: { displayName: name + ' Test', emailAddress: name.toLowerCase() + '@example.com' } });
    if (u.pathname === '/drive/v3/files' && m === 'GET') return json({ files: drive.text === null ? [] : [meta()] });
    if (u.pathname === '/drive/v3/files' && m === 'POST') return json({ id: 'P' });
    if (u.pathname === '/drive/v3/files/F' && u.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: 'application/json', body: drive.text });
    if (u.pathname === '/drive/v3/files/F') return json(meta());
    if (u.pathname === '/upload/drive/v3/files/F' && m === 'PATCH') { drive.text = req.postData(); drive.version++; drive.uploads++; return json({ version: String(drive.version) }); }
    if (u.pathname === '/upload/drive/v3/files' && m === 'POST') {
      const body = req.postData(); const content = body.split('\r\n\r\n')[2].split('\r\n--')[0];
      if (/"name":"budzet-domowy.json"/.test(body)) { drive.text = content; drive.version++; return json(meta()); }
      drive.snapshots++; drive.lastSnapshot = content; return json({ id: 'S' });
    }
    return json({ error: 'nieobsłużone ' + m + ' ' + u.pathname }, 500);
  });
  await page.goto(URL0); await page.waitForTimeout(500);
  await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('budzet-domowy', 1); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ value: 'tok', expiresAt: Date.now() + 3600e3, hint: '' }, 'google-token'); tx.oncomplete = res; }; }));
  await page.goto(URL0 + '#ustawienia'); await page.reload(); await page.waitForTimeout(900);
  const text = () => page.locator('body').innerText();
  const click = async (label) => { await page.getByRole('button', { name: label, exact: true }).first().click(); };
  const syncNow = async () => { await click('Synchronizuj teraz'); await page.waitForTimeout(900); };
  const state = async () => { const bar = await page.locator('.syncbar').allInnerTexts(); const err = await page.locator('p.error').allInnerTexts(); return bar.length ? 'PASEK: ' + bar[0].slice(0, 60) : err.length ? 'BŁĄD: ' + err[0].slice(0, 90) : 'ok'; };
  return { page, text, click, syncNow, errs, name, state };
}
const isEnv = () => { try { return JSON.parse(drive.text).format === 'budzet-domowy-szyfr'; } catch { return false; } };
const plainAttack = () => JSON.stringify({ schema: 3, categories: {}, accounts: {}, positions: {}, entries: {}, settings: { main: { id: 'main', updatedAt: '2099-01-01T00:00:00.000Z', updatedBy: 'x' } } });
const addCategory = async (d, name) => { // lokalna zmiana przez UI: kategoria
  await d.page.goto(URL0 + '#kategorie'); await d.page.waitForTimeout(300);
  await d.page.locator('button.primary').first().click(); await d.page.waitForTimeout(200);
  await d.page.getByPlaceholder('np. ZWIERZĘTA').fill(name);
  await d.page.getByRole('button', { name: 'Zapisz kategorię' }).click(); await d.page.waitForTimeout(3600);
  await d.page.goto(URL0 + '#ustawienia'); await d.page.waitForTimeout(400);
};
const setPassword = async (d, pw, button) => {
  await d.click(button); await d.page.waitForTimeout(200);
  const f = d.page.locator('input[type="password"]');
  await f.nth(0).fill(pw); if (await f.count() > 1) await f.nth(1).fill(pw);
  await f.nth(0).press('Enter'); await d.page.waitForTimeout(4500);
};

(async () => {
  const browser = await chromium.launch();
  const A = await device(browser, 'Jan');
  // 1. utworzenie pliku
  await A.click('Utwórz wspólny plik na Dysku'); await A.page.waitForTimeout(1200);
  ok('1. plik utworzony jawnie', drive.text !== null && !isEnv());
  await addCategory(A, 'TAJNA-KATEGORIA');
  ok('1b. zmiana lokalna trafia na Dysk', drive.text.includes('TAJNA-KATEGORIA'));
  // 2. włączenie szyfrowania
  await setPassword(A, 'haslo-testowe-123', 'Ustaw hasło');
  ok('2. po włączeniu hasła plik jest kopertą', isEnv() && !drive.text.includes('TAJNA-KATEGORIA'), (await A.text()).match(/Zsynchronizowano[^\n]*/)?.[0] ?? 'brak statusu');
  // 3. drugie urządzenie
  const B = await device(browser, 'Ewa');
  await B.click('Połącz z tym plikiem'); await B.page.waitForTimeout(1200);
  ok('3. drugie urządzenie prosi o hasło', /zaszyfrowane/i.test(await B.text()));
  await B.page.locator('.syncbar').getByRole('button', { name: 'Podaj hasło' }).click(); await B.page.waitForTimeout(200);
  await B.page.locator('input[type="password"]').first().fill('zle-haslo-zle-haslo'); await B.page.locator('input[type="password"]').first().press('Enter'); await B.page.waitForTimeout(3500);
  ok('3b. złe hasło – komunikat, brak danych', /Złe hasło/.test(await B.text()));
  await B.page.locator('input[type="password"]').first().fill('haslo-testowe-123'); await B.page.locator('input[type="password"]').first().press('Enter'); await B.page.waitForTimeout(4500);
  await B.page.goto(URL0 + '#kategorie'); await B.page.waitForTimeout(400);
  ok('3c. dobre hasło – dane widoczne u drugiej osoby', /TAJNA-KATEGORIA/.test(await B.page.locator('body').innerHTML()));
  await B.page.goto(URL0 + '#ustawienia'); await B.page.waitForTimeout(400);
  // 4. atak: podmiana na jawny plik
  drive.text = plainAttack(); drive.version++;
  await A.syncNow();
  ok('4. podmiana na jawny – pasek ostrzeżenia, nic nie wysłano', /nie jest zaszyfrowany/.test(await A.text()) && !drive.text.includes('TAJNA-KATEGORIA') && !isEnv());
  await A.click('Zostaw szyfrowanie'); await A.page.waitForTimeout(1200);
  ok('4b. „Zostaw szyfrowanie” przywraca kopertę', isEnv() && (await A.state()) === 'ok', await A.state());
  await A.page.goto(URL0 + '#kategorie'); await A.page.waitForTimeout(300);
  ok('4c. dane lokalne nietknięte', /TAJNA-KATEGORIA/.test(await A.page.locator('body').innerHTML()));
  await A.page.goto(URL0 + '#ustawienia'); await A.page.waitForTimeout(300);
  // 5. atak po „Zapomnij na tym urządzeniu”
  await B.syncNow();
  await B.click('Zapomnij na tym urządzeniu'); await B.page.waitForTimeout(400);
  drive.text = plainAttack(); drive.version++;
  await B.syncNow();
  ok('5. urządzenie bez klucza też odmawia', /nie jest zaszyfrowany/.test(await B.text()) && !drive.text.includes('TAJNA-KATEGORIA'));
  await A.syncNow(); await A.click('Zostaw szyfrowanie'); await A.page.waitForTimeout(1200);
  await B.syncNow();
  ok('5b. po przywróceniu koperty urządzenie bez klucza prosi o hasło', /Podaj hasło/.test(await B.text()), (await B.text()).slice(0, 120).replace(/\n/g, ' | '));
  await B.page.locator('.syncbar').getByRole('button', { name: 'Podaj hasło' }).click(); await B.page.waitForTimeout(200);
  await B.page.locator('input[type="password"]').first().fill('haslo-testowe-123'); await B.page.locator('input[type="password"]').first().press('Enter'); await B.page.waitForTimeout(4500);
  ok('5c. po haśle znów zsynchronizowane', (await B.state()) === 'ok', await B.state());
  // 6. zmiana hasła na A, gdy B zapisało coś starym kluczem
  await addCategory(B, 'ZMIANA-EWY');
  const before = drive.version;
  await setPassword(A, 'nowe-haslo-456789', 'Zmień hasło');
  ok('6. zmiana hasła mimo zapisu drugiej osoby starym kluczem', isEnv() && drive.version > before && (await A.state()) === 'ok', await A.state());
  await A.page.goto(URL0 + '#kategorie'); await A.page.waitForTimeout(300);
  ok('6b. zmiana drugiej osoby nie zginęła', /ZMIANA-EWY/.test(await A.page.locator('body').innerHTML()));
  await A.page.goto(URL0 + '#ustawienia'); await A.page.waitForTimeout(300);
  await B.syncNow();
  ok('6c. druga osoba jest pytana o nowe hasło', /Podaj hasło/.test(await B.text()));
  await B.page.locator('.syncbar').getByRole('button', { name: 'Podaj hasło' }).click(); await B.page.waitForTimeout(200);
  await B.page.locator('input[type="password"]').first().fill('nowe-haslo-456789'); await B.page.locator('input[type="password"]').first().press('Enter'); await B.page.waitForTimeout(4500);
  ok('6d. nowe hasło działa u drugiej osoby', (await B.state()) === 'ok', await B.state());
  // 7. wyłączenie szyfrowania na A, gdy B zapisało coś zaszyfrowanego
  await addCategory(B, 'DRUGA-ZMIANA');
  await A.click('Wyłącz szyfrowanie'); await A.page.waitForTimeout(4500);
  ok('7. wyłączenie szyfrowania: jawny plik ze scalonymi danymi', !isEnv() && drive.text.includes('DRUGA-ZMIANA') && drive.text.includes('TAJNA-KATEGORIA') && (await A.state()) === 'ok', await A.state());
  await B.syncNow();
  ok('7b. druga osoba dostaje pytanie zamiast cichego przyjęcia', /nie jest zaszyfrowany/.test(await B.text()));
  await B.click('Wyłączyliśmy je celowo'); await B.page.waitForTimeout(1500);
  ok('7c. po potwierdzeniu synchronizacja jawna działa', (await B.state()) === 'ok' && !isEnv(), await B.state());
  // 8. uszkodzony plik na Dysku
  const good = drive.text;
  for (const [label, bad] of [['nie-JSON', '<html>x'], ['pusty', ''], ['tablica', '[1,2]'], ['zły schemat', '{"schema":77}'], ['koperta-śmieć', JSON.stringify({ format: 'budzet-domowy-szyfr', schema: 99, kdf: null })]]) {
    drive.text = bad; drive.version++;
    await A.syncNow();
    const st = await A.state();
    ok('8. uszkodzony plik (' + label + ') – czytelny komunikat, plik nienadpisany', drive.text === bad && st.startsWith('BŁĄD') && !/Coś poszło nie tak/.test(await A.text()), st);
  }
  drive.text = good; drive.version++;
  await A.syncNow();
  ok('8b. po naprawie pliku synchronizacja wraca', (await A.state()) === 'ok', await A.state());
  ok('błędy JS w przeglądarce', A.errs.length + B.errs.length === 0, [...A.errs, ...B.errs].slice(0, 3).join(' ; '));
  console.log(log.join('\n'));
  await browser.close();
  if (log.some((l) => l.startsWith('FAIL'))) process.exit(1);
})().catch((e) => { console.log(log.join('\n')); console.error('PRZERWANE', e.message.slice(0, 400)); process.exit(1); });
