"use client";

// ブラウザの通知（チャット・納期で共通）。
// Android の Chrome などは、ページから直接 new Notification() を出せず、サービスワーカー（public/media-sw.js）から出す必要がある。
// なので、サービスワーカーがあればそこから出し、押したときもそこで受けてアプリの画面を開く（無いときだけ、ページから出す）

/** 通知を出すのに使うサービスワーカー（メディアのファイルを返すものと同じ） */
const WORKER = "/media-sw.js";

/** ブラウザの通知の許可の様子（使えない・まだ聞いていない・許可・拒否） */
export const notifyPermission = (): NotificationPermission | "unsupported" =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

/** 通知の許可を求める（ボタンを押した流れのまま呼ぶこと）。許可されたら true */
export async function askNotifyPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  const p = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  return p === "granted";
}

/** サービスワーカーを用意する（アプリを開いたときに1回） */
export function registerAppWorker() {
  navigator.serviceWorker?.register(WORKER).catch(() => {});
}

/** 通知を押したときに開く画面を、アプリの側で受け取る（サービスワーカーから知らせが来る）。戻り値で受け取りをやめる */
export function onNotificationOpen(open: (href: string) => void) {
  const sw = navigator.serviceWorker;
  if (!sw) return () => {};
  const on = (e: MessageEvent) => {
    if (e.data?.type === "irai-note:open" && typeof e.data.href === "string") open(e.data.href);
  };
  sw.addEventListener("message", on);
  // addEventListener のときは、これを呼ぶまで知らせが届かない
  sw.startMessages();
  return () => sw.removeEventListener("message", on);
}

export type AppNotice = {
  title: string;
  body: string;
  /** 同じ tag の通知は、新しいもので置き換わる（同じ発言を、開いているタブの数だけ出さないため） */
  tag: string;
  /** 押したときに開く画面 */
  href: string;
  /** 通知に出す絵（送った人のアイコンなど） */
  icon?: string;
};

/** 通知を出す。許可が無いときは何もしない */
export async function showAppNotice(n: AppNotice) {
  if (notifyPermission() !== "granted") return;
  const options = { body: n.body, tag: n.tag, icon: n.icon, data: { href: n.href } };
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (reg?.active) {
    await reg.showNotification(n.title, options);
    return;
  }
  try {
    const shown = new Notification(n.title, options);
    shown.onclick = () => {
      window.focus();
      window.location.href = n.href;
      shown.close();
    };
  } catch {
    // ページから出せないブラウザで、サービスワーカーも無いとき（出せない）
  }
}
