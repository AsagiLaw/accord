"use client";

import { sb, supa } from "@/lib/local/sync";
import type { AppNotice } from "@/lib/notify";

// アプリを閉じていても届く通知（Web Push：0018・/api/push）。Supabase 版だけ。
// 通知をオンにした端末を届け先にし、自分が発言したら /api/push に頼んで、ほかの人の端末に届けてもらう

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
// デスクトップ版はプッシュを使わない（トレイに隠れている間も動いているので、発言の通知はページから出す）
const usable = () => supa && !!publicKey && typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && !window.accordDesktop;

/** 公開鍵（base64url）を、ブラウザに渡す形にする */
function keyBytes(key: string) {
  const b64 = (key + "=".repeat((4 - (key.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** この端末を届け先にする（通知の許可があるときだけ。何度呼んでもよい：ログインし直した人に付け替わる） */
export async function subscribePush() {
  if (!usable() || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return;
    const { error } = await sb().rpc("push_subscribe", { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth });
    if (error) console.warn("通知の届け先を覚えられませんでした", error.message);
  } catch (e) {
    console.warn("通知の届け先を作れませんでした", e);
  }
}

/** この端末を届け先から外す */
export async function unsubscribePush() {
  if (!usable()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await sb().rpc("push_unsubscribe", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch {
    // 外せなくても、許可を取り消せば届かなくなる
  }
}

/** もう頼んだ発言（直して送り直しても、もう一度は頼まない） */
const asked = new Set<string>();
/** 書いてからこれより後に Supabase に届いた発言は、通知しない（サーバーの決まりと同じ） */
const FRESH = 10 * 60 * 1000;

/** 自分の発言が Supabase に届いたら、ほかの人の端末に通知を届けてもらう */
export async function pushMessage(m: { id: string; createdAt: number }, notice: () => Promise<AppNotice | null>) {
  if (!supa || !publicKey || asked.has(m.id) || Date.now() - m.createdAt > FRESH) return;
  asked.add(m.id);
  const n = await notice();
  if (!n) return;
  await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId: m.id, title: n.title, body: n.body, href: n.href, icon: n.icon }),
  }).catch(() => {});
}
