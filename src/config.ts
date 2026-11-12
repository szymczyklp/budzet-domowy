/**
 * Identyfikatory z Google Cloud Console (instrukcja w README, sekcja „Google Drive”).
 * To nie są sekrety – i tak trafiają do kodu strony. Klucz API ogranicz w konsoli
 * do adresu https://szymczyklp.github.io/* i do Google Picker API.
 */
export const GOOGLE = {
  /** Client ID typu „Web application”, kończy się na .apps.googleusercontent.com */
  clientId: '98071451897-2esbr917roqbab8unetdmd1vq934fb7d.apps.googleusercontent.com',
  /** Klucz API (dla Google Picker) */
  apiKey: 'AIzaSyC3QlSJWvHXfxIezwAQVHWiPOjfEA4xui0',
  /** Numer projektu (Project number) – same cyfry */
  appId: '98071451897',
  /**
   * Adres pośrednika logowania (Cloudflare Worker z katalogu worker/), np. https://budzet-auth.twojanazwa.workers.dev.
   * Pusty = logowanie bez pośrednika (token na ok. godzinę).
   */
  tokenProxy: 'https://budzet-auth.szymczyklp.workers.dev',
};
