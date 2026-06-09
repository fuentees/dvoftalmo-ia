import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

// In-memory rate limiter: 10 requests per minute per user on AI endpoints
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

const AI_PATHS = ["/api/chat", "/api/export", "/api/dados/analyze"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Rate limit AI endpoints
  if (AI_PATHS.some((p) => request.nextUrl.pathname.startsWith(p)) && request.method === "POST") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (!checkRateLimit(`${ip}:${request.nextUrl.pathname}`, 10, 60_000)) {
      return NextResponse.json(
        { error: "Muitas requisições. Aguarde 1 minuto antes de tentar novamente." },
        { status: 429 }
      );
    }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "local-anon-key",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  // Refresh session — required by Supabase SSR to keep tokens valid
  // Wrapped in try/catch: network failures should not crash the app
  try {
    await supabase.auth.getUser();
  } catch {
    // If Supabase auth is unreachable, continue — the session cookie is still valid
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
