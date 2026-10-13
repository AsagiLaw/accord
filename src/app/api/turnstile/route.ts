import { NextResponse, type NextRequest } from "next/server";

// ローカル版のログインで使う、Turnstile の確かめ。ブラウザから届いた token を、Cloudflare に問い合わせて確かめる。
// Supabase 版では使わない（token は Supabase に渡し、Supabase が確かめる）。
// シークレットキーはサーバーの中だけに置く（NEXT_PUBLIC_ を付けない）。開発中は Cloudflare の試し用のキー（いつも通る）

const TEST_SECRET = "1x0000000000000000000000000000000AA";
const secret = process.env.TURNSTILE_SECRET_KEY || (process.env.NODE_ENV !== "production" ? TEST_SECRET : "");

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";
  if (!secret || !token || token.length > 2048) return NextResponse.json({ ok: false }, { status: 400 });

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) form.append("remoteip", ip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return NextResponse.json({ ok: !!data.success, codes: data["error-codes"] ?? [] });
  } catch {
    // Cloudflare に届かないとき
    return NextResponse.json({ ok: false, codes: ["network"] }, { status: 502 });
  }
}
