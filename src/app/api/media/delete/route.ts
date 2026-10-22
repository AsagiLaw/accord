import { NextResponse, type NextRequest } from "next/server";
import { deleteKeys, listMediaKeys, r2 } from "@/lib/r2/server";
import { createClient } from "@/lib/supabase/server";

// R2 から画像のファイルを消す。
// deleted：完全に削除した画像（Supabase で消した印が付いていて、編集できるボックスのもの）の、ファイルを全部消す。
// shrunk：完全に削除したが、チャットなどで使われているので小さい画像だけ残した画像（gone）の、今の小さい画像のほかのファイルを消す（編集できるボックスのものだけ）。
// prune：編集して中身が変わった画像の、前の版（今の rev でないもの）のファイルを消す（編集できるボックスの画像だけ）。
// どちらも、ログインしている人として Supabase で確かめてから消す

/** 一度に扱える画像の数 */
const MAX = 100;
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);

type Row = { id: string; box_id: string; deleted: boolean; rev: string | null; gone: string | null };

export async function POST(request: NextRequest) {
  if (!r2) return NextResponse.json({ error: "R2 の設定がありません" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { deleted?: unknown; shrunk?: unknown; prune?: unknown } | null;
  const deleted = Array.isArray(body?.deleted) ? body.deleted.filter(isId) : [];
  const shrunk = Array.isArray(body?.shrunk) ? body.shrunk.filter(isId) : [];
  const prune = Array.isArray(body?.prune)
    ? (body.prune as { id?: unknown; rev?: unknown }[]).filter((p): p is { id: string; rev: number } => isId(p?.id) && Number.isInteger(p?.rev) && (p.rev as number) >= 0)
    : [];
  if (!deleted.length && !shrunk.length && !prune.length) return NextResponse.json({ removed: 0 });
  if (deleted.length + shrunk.length + prune.length > MAX) return NextResponse.json({ error: "多すぎます" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "ログインしていません" }, { status: 401 });

  // 見られる画像の情報（消した印が付いたものも見られる）
  const ids = [...new Set([...deleted, ...shrunk, ...prune.map((p) => p.id)])];
  const { data, error } = await supabase
    .from("synced_rows")
    .select("id,box_id,deleted,rev:data->>rev,gone:data->>gone")
    .eq("tbl", "media")
    .in("id", ids)
    .returns<Row[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = new Map(data.map((r) => [r.id, r]));

  const remove: string[] = [];
  // 消せるのは、編集できるボックス（持ち主か、編集もできる共有）の画像だけ
  const editable = new Map<string, boolean>();
  const canEdit = async (box: string) => {
    if (!editable.has(box)) editable.set(box, (await supabase.rpc("can_edit_box", { target: box })).data === true);
    return editable.get(box)!;
  };
  // 完全に削除した画像：消した印が付いているものの、ファイルを全部
  for (const id of deleted) {
    const r = rows.get(id);
    if (!r?.deleted || !(await canEdit(r.box_id))) continue;
    remove.push(...((await listMediaKeys(id)) ?? []));
  }
  // 小さい画像だけ残した画像：gone の印が付いているものの、今の rev の小さい画像のほかを
  for (const id of shrunk) {
    const r = rows.get(id);
    if (!r || r.deleted || r.gone !== "true" || !(await canEdit(r.box_id))) continue;
    const keep = `media/${id}/${Number(r.rev ?? 0)}/thumb`;
    remove.push(...((await listMediaKeys(id)) ?? []).filter((k) => k !== keep));
  }
  // 前の版：今の rev と同じ画像の、ほかの rev のファイルを
  for (const p of prune) {
    const r = rows.get(p.id);
    if (!r || r.deleted || Number(r.rev ?? 0) !== p.rev || !(await canEdit(r.box_id))) continue;
    const keys = (await listMediaKeys(p.id)) ?? [];
    remove.push(...keys.filter((k) => k.split("/")[2] !== String(p.rev)));
  }
  const failed = await deleteKeys(remove);
  return NextResponse.json({ removed: remove.length - failed, failed });
}
