/**
 * CORS — strict origin whitelist, shared by every function.
 * Only the app's own origins are allowed. Any other origin gets a non-matching origin back, which
 * makes the browser block the response.
 */

export const ALLOWED_ORIGINS = [
  "http://tauri.localhost",   // Tauri production build (Windows, Android)
  "https://tauri.localhost",  // Tauri production (HTTPS variant)
  "http://localhost:1420",    // Vite dev server (tauri dev)
  "tauri://localhost",        // Tauri on Linux/macOS (custom scheme): Linux test bench app
];

/** CORS headers for a request; `methods` lists what the function answers, e.g. "POST, OPTIONS". */
export function corsHeaders(req: Request, methods: string): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Max-Age": "86400",
  };
}
