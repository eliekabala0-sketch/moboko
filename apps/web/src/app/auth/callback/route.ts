import { getSiteUrl } from "@/lib/auth/site-url";
import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Échange le code PKCE Supabase après OAuth (Google, Apple, etc.).
 */
export async function GET(request: NextRequest) {
  const site = getSiteUrl();
  const code = request.nextUrl.searchParams.get("code");

  const failRedirect = (detail?: string | null) => {
    const q = detail
      ? `?error=oauth&detail=${encodeURIComponent(detail)}`
      : "?error=oauth";
    return NextResponse.redirect(`${site}/auth${q}`);
  };

  if (!code) {
    const err =
      request.nextUrl.searchParams.get("error_description") ||
      request.nextUrl.searchParams.get("error");
    return failRedirect(err);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.redirect(`${site}/auth?error=config`);
  }

  const response = NextResponse.redirect(`${site}/`);

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return failRedirect(error.message);
  }
  return response;
}
