// メディアの元の画像を「/media-file/<画像の ID>/<ファイル名>」という URL で返す（ブラウザの中の保存場所 IndexedDB から読む）。
// 画像をドラッグして他のアプリ（Photoshop・デスクトップなど）に渡すと、この URL の最後の部分がファイル名になる。
// サーバー版に移ったら、画像はサーバーの URL で表示するので、これは要らなくなる

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
        get.onsuccess = () => done(get.result?.original ?? null);
        get.onerror = () => done(null);
      } catch {
        done(null);
      }
    };
  });
}
