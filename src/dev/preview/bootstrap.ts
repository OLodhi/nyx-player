/**
 * bootstrap.ts — Doit être le PREMIER import de main.tsx.
 *
 * En mode preview (DEV + ?preview), injecte la session Supabase factice et la plateforme
 * AVANT que supabaseClient / plugin-os ne s'initialisent. Hors preview : aucun effet,
 * et `import.meta.env.DEV === false` en build → tout ce code est éliminé.
 */

export const PREVIEW_USER_ID = '00000000-0000-4000-8000-000000000001';

export const IS_PREVIEW = import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview');

if (IS_PREVIEW) {
  const requested = new URLSearchParams(window.location.search).get('preview') || 'android';
  // « androidtv » : plateforme Android + interface télécommande (cf. utils/platform.ts)
  const platform = requested === 'androidtv' ? 'android' : requested;
  // Dans une vraie WebView Tauri la propriété existe déjà (et est en lecture seule) : on garde la vraie plateforme.
  if (!('__TAURI_OS_PLUGIN_INTERNALS__' in window)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- propriété interne du plugin Tauri, absente des types de window
    (window as any).__TAURI_OS_PLUGIN_INTERNALS__ = {
      platform, os_type: platform, family: platform === 'windows' ? 'windows' : 'unix',
      version: '15', arch: 'x86_64', exe_extension: '', eol: '\n', hostname: 'preview',
    };
  }

  const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL;
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
  const user = {
    id: PREVIEW_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'preview@nyxplayer.local',
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
  };
  // `&screen=login` : pas de session factice → écran de connexion (revue de mise en page)
  if (new URLSearchParams(window.location.search).get('screen') === 'login') {
    localStorage.removeItem(`sb-${projectRef}-auth-token`);
  } else {
    localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify({
      access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: PREVIEW_USER_ID, exp: expiresAt, role: 'authenticated' })}.preview`,
      token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, refresh_token: 'preview', user,
    }));
  }
}

export const previewReady: Promise<void> = IS_PREVIEW
  ? import('./installPreviewMocks').then((m) => m.installPreviewMocks())
  : Promise.resolve();
