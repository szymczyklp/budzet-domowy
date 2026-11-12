/**
 * Budżet domowy – pośrednik logowania Google (Cloudflare Worker).
 *
 * Po co: przeglądarka sama dostaje od Google token tylko na godzinę. Dłuższa sesja wymaga
 * „refresh tokenu”, a ten można wymienić tylko z sekretem klienta OAuth – który nie może być w kodzie strony.
 * Worker trzyma sekret, wymienia kod logowania na tokeny i odświeża token dostępu.
 *
 * Refresh token nie jest nigdzie przechowywany po stronie Workera: wraca do aplikacji zaszyfrowany
 * kluczem SEALING_KEY (AES-GCM) i tylko ten Worker umie go odczytać.
 *
 * Zmienne (Settings → Variables and Secrets):
 *   GOOGLE_CLIENT_ID      – Client ID klienta „Budżet web”
 *   GOOGLE_CLIENT_SECRET  – sekret tego klienta (jako Secret)
 *   SEALING_KEY           – losowy tekst, min. 32 znaki (jako Secret), np. z generatora haseł
 *   ALLOWED_ORIGIN        – https://szymczyklp.github.io (można kilka, po przecinku, np. z http://localhost:5173)
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// klucz pieczętowania = SHA-256 z SEALING_KEY, więc wystarczy dowolny długi losowy tekst (np. z generatora haseł)
const sealingKey = async (env) => {
  if (!env.SEALING_KEY || env.SEALING_KEY.length < 32) throw new Error('SEALING_KEY: ustaw losowy tekst, min. 32 znaki');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SEALING_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealingKey(env), new TextEncoder().encode(text));
  return `${b64(iv)}.${b64(data)}`;
}

async function unseal(env, sealed) {
  const [iv, data] = String(sealed).split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await sealingKey(env), unb64(data));
  return new TextDecoder().decode(plain);
}

const allowed = (env, origin) => (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean).includes(origin);

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });

async function google(env, params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  return { status: res.status, body: await res.json() };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!allowed(env, origin)) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return json({}, 200, origin);
    if (request.method !== 'POST') return json({ error: 'method' }, 405, origin);

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    // żądania aplikacji mają kilkaset bajtów; większe odrzucamy bez czytania
    if (Number(request.headers.get('Content-Length') || 0) > 16384) return json({ error: 'too_large' }, 413, origin);
    let input;
    try {
      const text = await request.text();
      if (text.length > 16384) return json({ error: 'too_large' }, 413, origin);
      input = JSON.parse(text);
    } catch { return json({ error: 'bad_json' }, 400, origin); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'bad_json' }, 400, origin);

    try {
      if (path === '/token') {
        // kod z logowania → token dostępu + zapieczętowany refresh token
        const redirect = String(input.redirect_uri || '');
        let redirectOrigin = '';
        try { redirectOrigin = new URL(redirect).origin; } catch { /* zły adres */ }
        if (!allowed(env, redirectOrigin)) return json({ error: 'redirect_uri' }, 400, origin);
        const { status, body } = await google(env, {
          grant_type: 'authorization_code',
          code: String(input.code || ''),
          redirect_uri: redirect,
          code_verifier: String(input.code_verifier || ''),
        });
        if (status !== 200) return json({ error: body.error || 'token', detail: body.error_description }, 400, origin);
        return json({
          access_token: body.access_token,
          expires_in: body.expires_in,
          scope: body.scope,
          sealed: body.refresh_token ? await seal(env, body.refresh_token) : undefined,
        }, 200, origin);
      }

      if (path === '/refresh') {
        let refresh;
        try { refresh = await unseal(env, input.sealed); } catch { return json({ error: 'invalid_grant' }, 400, origin); }
        const { status, body } = await google(env, { grant_type: 'refresh_token', refresh_token: refresh });
        if (status !== 200) return json({ error: body.error || 'refresh', detail: body.error_description }, 400, origin);
        return json({ access_token: body.access_token, expires_in: body.expires_in, scope: body.scope }, 200, origin);
      }

      if (path === '/revoke') {
        try {
          const refresh = await unseal(env, input.sealed);
          await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: 'POST' });
        } catch { /* już nieważny */ }
        return json({ ok: true }, 200, origin);
      }

      return json({ error: 'not_found' }, 404, origin);
    } catch (e) {
      // szczegóły tylko w logach Workera – odpowiedź nie zdradza konfiguracji
      console.error(e);
      return json({ error: 'server' }, 500, origin);
    }
  },
};
