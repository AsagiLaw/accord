// メディアの元の画像（PSD は表示用にした PNG）を「/media-file/<画像の ID>/<ファイル名>」（編集した画像は「/media-file/<画像の ID>/<編集の回数>/<ファイル名>」）という URL で返す（ブラウザの中の保存場所 IndexedDB から読む）。
// 画像をドラッグして他のアプリ（Photoshop・デスクトップなど）に渡すと、この URL の最後の部分がファイル名になる。
// サーバー版に移ったら、画像はサーバーの URL で表示するので、これは要らなくなる

// ブラウザの通知（src/lib/notify.ts）もここから出す（Android の Chrome などは、ページから直接出せないため）。アプリを閉じているときのプッシュ通知も受ける。
// 通知を押したら、開いているアプリの画面に知らせてそこで開く（アプリの中の移動で開く）。開いていなければ新しく開く

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/media-file/")) return;
  const parts = url.pathname.split("/");
  const id = decodeURIComponent(parts[2] ?? "");
  // 編集した画像は、ID とファイル名の間に編集の回数が入る
  const rev = parts.length > 4 ? Number(parts[3]) || 0 : 0;
  e.respondWith(
    readOriginal(id, rev).then((blob) =>
      blob
        ? new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } })
        : new Response("not found", { status: 404 }),
    ),
  );
});

/**
 * ブラウザの中の画像を読む。画像のファイル一式（mediaBlobs）が今のものならそこから。
 * 無ければ、表示とドラッグに使う分だけを取ってきたもの（blobCache の「ID:rev:view」（PSD の表示用の PNG）か「ID:rev:original」）
 */
function readOriginal(id, rev) {
  return new Promise((resolve) => {
    const req = indexedDB.open("irai-note");
    // まだデータベースが無いときに、空のものを作ってしまわないようにする
    req.onupgradeneeded = () => req.transaction.abort();
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      const done = (v) => {
        db.close();
        resolve(v);
      };
      const get = (store, key) =>
        new Promise((ok) => {
          try {
            const r = db.transaction(store).objectStore(store).get(key);
            r.onsuccess = () => ok(r.result);
            r.onerror = () => ok(undefined);
          } catch {
            ok(undefined);
          }
        });
      (async () => {
        const row = await get("mediaBlobs", id);
        // 自分の画像（remoteRev が無い）か、ほかの人の画像で中身が今のもの
        if (row && (row.remoteRev === undefined || row.remoteRev === rev)) return row.view ?? row.original;
        const cached = (await get("blobCache", `${id}:${rev}:view`)) ?? (await get("blobCache", `${id}:${rev}:original`));
        return cached?.blob ?? row?.view ?? row?.original ?? null;
      })().then(done, () => done(null));
    };
  });
}

// アプリを閉じているときに届いた発言の通知（Web Push：src/app/api/push）。
// アプリを画面に出している間は、アプリの側（src/lib/local/chatNotify.ts）が既読を見てから出すので、ここでは出さない
self.addEventListener("push", (e) => {
  let n = {};
  try {
    n = e.data ? e.data.json() : {};
  } catch {
    return;
  }
  if (!n.title) return;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      if (list.some((c) => c.visibilityState === "visible")) return;
      return Promise.all([
        self.registration.showNotification(n.title, {
          body: n.body,
          tag: n.tag,
          icon: n.icon || "/icons/icon-192.png",
          data: { href: n.href || "/" },
        }),
        addBadge(),
      ]);
    }),
  );
});

// アイコンの未読の数（src/lib/local/appBadge.ts と同じ置き場所）。閉じている間は、届いた通知の分だけ足す。
// 開いたら、アプリが本当の数に数え直す
const BADGE_CACHE = "accord-badge";
const BADGE_KEY = "/accord-badge-count";

async function addBadge() {
  try {
    const cache = await caches.open(BADGE_CACHE);
    const now = Number(await (await cache.match(BADGE_KEY))?.text()) || 0;
    await cache.put(BADGE_KEY, new Response(String(now + 1)));
    await self.navigator.setAppBadge?.(now + 1);
  } catch {
    // 使えない端末
  }
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const href = e.notification.data?.href || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (!win) return self.clients.openWindow(href);
      win.postMessage({ type: "irai-note:open", href });
      return win.focus();
    }),
  );
});
