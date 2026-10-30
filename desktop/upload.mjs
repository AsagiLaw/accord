// 作った配布物を R2 の desktop/ に置く（/api/download がここから配る）。同じ名前で上書きするので、配る物はいつも最新の1つ。
// 手元では：node --env-file=../.env.local upload.mjs
// 分けて送る（回線が遅くても時間切れにならず、失敗した分だけ送り直せる。全部届くまでは、前の版がそのまま配られる）
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("R2 の設定（R2_ACCOUNT_ID・R2_ACCESS_KEY_ID・R2_SECRET_ACCESS_KEY・R2_BUCKET）がありません");
  process.exit(1);
}

const bundle = path.join(import.meta.dirname, "src-tauri", "target", "release", "bundle", "nsis");
const built = (await readdir(bundle).catch(() => [])).find((n) => n.endsWith("-setup.exe"));
if (!built) {
  console.error("配布物がありません（先に npm run dist）");
  process.exit(1);
}
const NAME = "Accord-Setup.exe";

const PART_SIZE = 5 * 1024 * 1024;
/** 同時に送る数 */
const PARALLEL = 4;
/** 1つの分割を送り直す回数 */
const RETRIES = 3;

const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });

async function request(url, init) {
  const res = await r2.fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res;
}

async function sendPart(url, uploadId, partNumber, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await request(`${url}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`, { method: "PUT", body });
      return { partNumber, etag: res.headers.get("etag") };
    } catch (e) {
      if (attempt > RETRIES) throw e;
    }
  }
}

const file = await readFile(path.join(bundle, built));
const url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/desktop/${NAME}`;
const started = await (await request(`${url}?uploads`, { method: "POST" })).text();
const uploadId = started.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
if (!uploadId) throw new Error("分けて送る準備ができませんでした");

try {
  const count = Math.ceil(file.length / PART_SIZE);
  const parts = [];
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      parts[i] = await sendPart(url, uploadId, i + 1, file.subarray(i * PART_SIZE, (i + 1) * PART_SIZE));
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  const list = parts.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`).join("");
  await request(`${url}?uploadId=${encodeURIComponent(uploadId)}`, { method: "POST", body: `<CompleteMultipartUpload>${list}</CompleteMultipartUpload>` });
} catch (e) {
  await r2.fetch(`${url}?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(() => {});
  throw e;
}
console.log(`${NAME}（${(file.length / 1024 / 1024).toFixed(1)} MB）を置きました`);
