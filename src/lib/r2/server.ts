import { AwsClient } from "aws4fetch";

// Cloudflare R2（画像のファイルの置き場所）を、サーバーから扱う部品。鍵はサーバーの環境変数だけに置く（NEXT_PUBLIC_ を付けない）。
// ルートハンドラー（src/app/api）からだけ使う。ブラウザで動くファイルからは読み込まない
// R2 は S3 と同じやり方で扱える（aws4fetch で署名する）

const account = process.env.R2_ACCOUNT_ID ?? "";
const bucket = process.env.R2_BUCKET ?? "";

export const r2 =
  account && bucket && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    ? new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" })
    : null;

/** バケットの中の、その置き場所の URL（key が無ければバケットそのもの） */
export const objectUrl = (key = "") => new URL(`https://${account}.r2.cloudflarestorage.com/${bucket}/${key}`);

/** デスクトップ版の配布物の名前（desktop/upload.mjs が R2 の desktop/ に置く） */
export const DESKTOP_FILES = { windows: "Accord-Setup.exe", mac: "Accord.dmg" } as const;
export type DesktopPlatform = keyof typeof DESKTOP_FILES;
export const desktopFileUrl = (platform: DesktopPlatform) => objectUrl(`desktop/${DESKTOP_FILES[platform]}`);

/** その画像のファイルの置き場所（「media/画像の ID/rev/種類」）を全部 */
export async function listMediaKeys(id: string): Promise<string[] | null> {
  if (!r2) return null;
  const url = objectUrl();
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", `media/${id}/`);
  const res = await r2.fetch(url).catch(() => null);
  if (!res?.ok) return null;
  const xml = await res.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
}

/** ファイルを消す。消せなかったもの（つながらなかったなど）の数を返す */
export async function deleteKeys(keys: string[]) {
  if (!r2) return keys.length;
  let failed = 0;
  for (const key of keys) {
    const res = await r2.fetch(objectUrl(key), { method: "DELETE" }).catch(() => null);
    // 204：消した（もう無いときも 204 が返る）
    if (!res?.ok) failed++;
  }
  return failed;
}
