import { createClient as createAdmin } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import webpush from "web-push";
import { supabaseUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// 発言の通知を、アプリを閉じている人のスマホなどにも届ける（Web Push：0018）。
// 発言を書いた人のアプリが、Supabase に書けたあとで呼ぶ。見出しと本文は書いた人のアプリが作る（場所の名前などはブラウザの中にあるため）。
// 届け先はサーバーだけが読む（Supabase の秘密鍵）。鍵は NEXT_PUBLIC_ を付けずにサーバーの中だけに置く

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const ready = Boolean(publicKey && privateKey && secretKey && supabaseUrl);
if (ready) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://github.com/AsagiLaw/accord", publicKey, privateKey);

type Notice = { messageId: string; title: string; body: string; href: string; icon?: string };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function parse(body: unknown): Notice | null {
  const b = body as Record<string, unknown> | null;
  if (typeof b?.messageId !== "string" || !/^[\w-]{1,100}$/.test(b.messageId)) return null;
  if (typeof b.title !== "string" || typeof b.body !== "string") return null;
  // 押したときに開くのは、このアプリの中の画面だけ
  if (typeof b.href !== "string" || !b.href.startsWith("/") || b.href.startsWith("//") || b.href.length > 300) return null;
  // 通知の中身は 4KB までなので、絵はアイコンの URL だけ（画像をそのまま埋めたものは送らない）
  const icon = typeof b.icon === "string" && /^https?:\/\//.test(b.icon) && b.icon.length <= 500 ? b.icon : undefined;
  return { messageId: b.messageId, title: cut(b.title, 100), body: cut(b.body, 300), href: b.href, icon };
}

export async function POST(request: NextRequest) {
  if (!ready) return NextResponse.json({ error: "プッシュ通知の設定がありません" }, { status: 503 });
  const notice = parse(await request.json().catch(() => null));
  if (!notice) return NextResponse.json({ error: "形が違います" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "ログインしていません" }, { status: 401 });

  const admin = createAdmin(supabaseUrl, secretKey, { auth: { persistSession: false } });
  // 書いた本人で、書いたばかりの発言のときだけ届け先が返る（同じ発言は1回だけ）
  const { data: targets, error } = await admin.rpc("push_targets", { p_message: notice.messageId, p_author: auth.user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const payload = JSON.stringify({ title: notice.title, body: notice.body, tag: `chat:${notice.messageId}`, href: notice.href, icon: notice.icon });
  const gone: string[] = [];
  await Promise.all(
    ((targets ?? []) as { endpoint: string; p256dh: string; auth: string }[]).map((t) =>
      webpush
        .sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, { TTL: 60 * 60 * 24, urgency: "high" })
        .catch((e: { statusCode?: number }) => {
          // 許可を取り消した・アプリを消したなどで、もう届かない届け先
          if (e.statusCode === 404 || e.statusCode === 410) gone.push(t.endpoint);
        }),
    ),
  );
  if (gone.length) await admin.rpc("push_forget", { p_endpoints: gone });
  return NextResponse.json({ sent: (targets ?? []).length - gone.length });
}
