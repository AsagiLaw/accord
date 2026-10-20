import { AwsClient } from "aws4fetch";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 画像のファイル（Cloudflare R2）を置く・読むための、期限付きの札（署名付き URL）を出す（第3段階）。
// ブラウザはこの札で R2 に直接置き・直接読む（画像のファイルは Vercel を通らない）。
// 札を出す前に、ログインしている人として Supabase で確かめる：読むのは見られる画像だけ（synced_rows の決まり：0014、貼られている画像：0017）、
// 置くのは編集もできるボックスの画像だけ（can_edit_box）。R2 の鍵はサーバーの中だけに置く（NEXT_PUBLIC_ を付けない）

const account = process.env.R2_ACCOUNT_ID ?? "";
const bucket = process.env.R2_BUCKET ?? "";
const r2 =
  account && bucket && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    ? new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" })
    : null;

/** 画像のファイルの種類：小さい画像・元の画像・表示用（PSD）・編集する前の元の画像・編集の情報（JSON） */
const KINDS = ["thumb", "original", "view", "source", "meta"] as const;
type Kind = (typeof KINDS)[number];
type Op = { id: string; rev: number; kind: Kind; op: "get" | "put" };

/** R2 の中の置き場所。中身を変えるたびに rev が上がるので、古い札やブラウザに残った古い画像と混ざらない */
const keyOf = (o: Op) => `media/${o.id}/${o.rev}/${o.kind}`;

/** 一度に出せる札の数 */
const MAX_OPS = 200;

function parse(body: unknown): Op[] | null {
  const ops = (body as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops) || ops.length > MAX_OPS) return null;
  const out: Op[] = [];
  for (const o of ops as Record<string, unknown>[]) {
    if (typeof o?.id !== "string" || !/^[\w-]{1,64}$/.test(o.id)) return null;
    if (typeof o.rev !== "number" || !Number.isInteger(o.rev) || o.rev < 0 || o.rev > 1e6) return null;
    if (!KINDS.includes(o.kind as Kind) || (o.op !== "get" && o.op !== "put")) return null;
    out.push({ id: o.id, rev: o.rev, kind: o.kind as Kind, op: o.op });
  }
  return out;
}

export async function POST(request: NextRequest) {
  if (!r2) return NextResponse.json({ error: "R2 の設定がありません" }, { status: 503 });
  const ops = parse(await request.json().catch(() => null));
  if (!ops) return NextResponse.json({ error: "形が違います" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "ログインしていません" }, { status: 401 });

  // 見られる画像（決まりで、見られないものは返ってこない）
  const ids = [...new Set(ops.map((o) => o.id))];
  const { data: rows, error } = await supabase.from("synced_rows").select("id,box_id,deleted").eq("tbl", "media").in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const visible = new Map((rows ?? []).filter((r) => !r.deleted).map((r) => [r.id as string, r.box_id as string]));
  // ボックスでは見られなくても、見られる発言やノートに貼られている画像は読んでよい（0017。DM で送られた画像など）
  const others = [...new Set(ops.filter((o) => o.op === "get" && !visible.has(o.id)).map((o) => o.id))];
  if (others.length) {
    const { data: referenced } = await supabase.rpc("media_for_ids_checked", { ids: others });
    for (const r of (referenced ?? []) as { id: string; box_id: string }[]) visible.set(r.id, r.box_id);
  }

  // 置くときは、その画像のボックスを編集できるか（ボックスごとに1回だけ確かめる）
  const editable = new Map<string, boolean>();
  for (const box of new Set(ops.filter((o) => o.op === "put").flatMap((o) => (visible.has(o.id) ? [visible.get(o.id)!] : [])))) {
    const { data } = await supabase.rpc("can_edit_box", { target: box });
    editable.set(box, data === true);
  }

  const urls: (string | null)[] = [];
  for (const o of ops) {
    const box = visible.get(o.id);
    const allowed = !!box && (o.op === "get" || editable.get(box) === true);
    if (!allowed) {
      // まだ Supabase に画像の情報が届いていない（置くのが早すぎた）・見られない・消された
      urls.push(null);
      continue;
    }
    const url = new URL(`https://${account}.r2.cloudflarestorage.com/${bucket}/${keyOf(o)}`);
    // 置く札は10分、読む札は1時間で使えなくなる
    url.searchParams.set("X-Amz-Expires", o.op === "put" ? "600" : "3600");
    const signed = await r2.sign(new Request(url, { method: o.op === "put" ? "PUT" : "GET" }), { aws: { signQuery: true } });
    urls.push(signed.url);
  }
  return NextResponse.json({ urls });
}
