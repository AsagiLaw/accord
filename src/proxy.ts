import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Supabase 版：ページを開くたびに、ログインの期限を延ばす（クッキーを新しくする）。
 * ログインしていないときにログイン画面へ移すのは、画面の側（AuthGate）で行う（データがまだブラウザの中にあるため）。
 * ローカル版では何もしない
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // ここで確かめると、期限が近いログインが新しくなる
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // 画像やスクリプトなどのファイルには使わない
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|js)$).*)"],
};
