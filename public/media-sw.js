// メディアの元の画像（PSD は表示用にした PNG）を「/media-file/<画像の ID>/<ファイル名>」（編集した画像は「/media-file/<画像の ID>/<編集の回数>/<ファイル名>」）という URL で返す（ブラウザの中の保存場所 IndexedDB から読む）。
// 画像をドラッグして他のアプリ（Photoshop・デスクトップなど）に渡すと、この URL の最後の部分がファイル名になる。
// サーバー版に移ったら、画像はサーバーの URL で表示するので、これは要らなくなる

// ブラウザの通知（src/lib/notify.ts）もここから出す（Android の Chrome などは、ページから直接出せないため）。
// 通知を押したら、開いているアプリの画面に知らせてそこで開く（アプリの中の移動で開く）。開いていなければ新しく開く

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/media-file/")) return;
  const id = decodeURIComponent(url.pathname.split("/")[2] ?? "");
  e.respondWith(
    readOriginal(id).then((blob) =>
      blob
        ? new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } })
        : new Response("not found", { status: 404 }),
    ),
  );
});

function readOriginal(id) {
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
      try {
        const get = db.transaction("mediaBlobs").objectStore("mediaBlobs").get(id);
        get.onsuccess = () => done(get.result?.view ?? get.result?.original ?? null);
        get.onerror = () => done(null);
      } catch {
        done(null);
      }
    };
  });
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
