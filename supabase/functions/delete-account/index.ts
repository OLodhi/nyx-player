import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as jose from "jsr:@panva/jose@6";
import { signedInRecently } from "../_shared/recentSignIn.ts";
import { isSignedInAccount, TOKEN_AUDIENCE } from "../_shared/tokenClaims.ts";
import { corsHeaders } from "../_shared/cors.ts";

// CORS: the app's origins only (shared list, see ../_shared/cors.ts)
const getCorsHeaders = (req: Request) => corsHeaders(req, "POST, OPTIONS");

// ============================================================================
// JWT VERIFICATION — Asymmetric JWKS (official Supabase pattern)
// Uses the project's public JWKS endpoint to verify JWT signatures.
// This replaces the gateway verify_jwt flag which is incompatible with
// new asymmetric JWT signing keys and Tauri origins.
// Ref: https://supabase.com/docs/guides/functions/auth
// ============================================================================

const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? Deno.env.get("SUPABASE_URL") + "/auth/v1";

const SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
  new URL(Deno.env.get("SUPABASE_URL")! + "/auth/v1/.well-known/jwks.json")
);

async function verifyAndExtractUserId(req: Request): Promise<{ userId: string; payload: Record<string, unknown> }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }

  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) {
    throw new Error("Auth header is not 'Bearer {token}'");
  }

  // Verify signature + expiration + issuer + audience cryptographically
  const { payload } = await jose.jwtVerify(token, SUPABASE_JWT_KEYS, {
    issuer: SUPABASE_JWT_ISSUER,
    audience: TOKEN_AUDIENCE,
  });
  // Signed-in accounts only: no anonymous sign-in
  if (!isSignedInAccount(payload as Record<string, unknown>)) {
    throw new Error("Invalid token: not a signed-in account");
  }

  const userId = payload.sub;
  if (!userId) {
    throw new Error("Invalid token: missing user ID (sub claim)");
  }

  return { userId, payload: payload as Record<string, unknown> };
}

// ============================================================================
// SERVER KEY — new secret key first, legacy service_role key as a fallback
// The legacy keys stop working once disabled (Supabase session, before end 2026): reading the new
// `sb_secret_…` key first lets this code be deployed now and keep working after that switch.
// ============================================================================

function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
    if (typeof keys.default === "string" && keys.default) return keys.default;
  } catch {
    // Unreadable variable: fall back to the legacy key below
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Verify JWT signature + extract authenticated user ID
    // No account id and no internal detail in the logs or the response
    let userId: string;
    let payload: Record<string, unknown>;
    try {
      ({ userId, payload } = await verifyAndExtractUserId(req));
    } catch (err) {
      console.error("[delete-account] JWT verification failed:", err instanceof Error ? err.name : "unknown");
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        }
      );
    }

    if (!signedInRecently(payload, Math.floor(Date.now() / 1000))) {
      console.warn("[delete-account] refused: no recent password sign-in");
      return new Response(
        JSON.stringify({ error: "Recent sign-in required" }),
        {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        }
      );
    }

    // 2. Create admin client (server key — bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serverKey()
    );

    // 3. Delete user via admin API
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) {
      // Error name and status only: the message of a failed internal call quotes the address
      // called, which holds the id of the account being deleted
      console.error("[delete-account] Error deleting the account:", error.name, error.status ?? "");
      return new Response(
        JSON.stringify({ error: "Account deletion failed" }),
        {
          status: 500,
          headers: { ...cors, "Content-Type": "application/json" },
        }
      );
    }


    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[delete-account] Unexpected error:", err instanceof Error ? err.name : "unknown");
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  }
});
