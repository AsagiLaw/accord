import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/validate";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * メールのリンク（登録の確認・パスワードの再設定・メールアドレスの変更）や、Google から戻ってくる先。
 * 届いた code でログインを仕上げてから、next の画面へ移る（Supabase 版だけ）
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"));
  if (!isSupabaseConfigured) return NextResponse.redirect(new URL("/login", url.origin));

  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  // Google の画面でやめたときなど
  const kind = url.searchParams.get("error") ? "google" : "link";
  return NextResponse.redirect(new URL(`/login?error=${kind}`, url.origin));
}
