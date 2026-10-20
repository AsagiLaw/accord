import { NextResponse, type NextRequest } from "next/server";
import { deleteKeys, listMediaKeys, r2 } from "@/lib/r2/server";
import { createClient } from "@/lib/supabase/server";

// R2 から画像のファイルを消す。
// deleted：完全に削除した画像（Supabase で消した印が付いていて、消したのが入れた本人のもの）の、ファイルを全部消す。
// prune：編集して中身が変わった画像の、前の版（今の rev でないもの）のファイルを消す（編集できるボックスの画像だけ）。
// どちらも、ログインしている人として Supabase で確かめてから消す

/** 一度に扱える画像の数 */
const MAX = 100;
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,64}$/.test(v);

type Row = { id: string; box_id: string; deleted: boolean; uploadedBy: string | null; rev: string | null };

export async function POST(request: NextRequest) {
  if (!r2) return NextResponse.json({ error: "R2 の設定がありません" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as { deleted?: unknown; prune?: unknown } | null;
  const deleted = Array.isArray(body?.deleted) ? body.deleted.filter(isId) : [];
  const prune = Array.isArray(body?.prune)
    ? (body.prune as { id?: unknown; rev?: unknown }[]).filter((p): p is { id: string; rev: number } => isId(p?.id) && Number.isInteger(p?.rev) && (p.rev as number) >= 0)
    : [];
  if (!deleted.length && !prune.length) return NextResponse.json({ removed: 0 });
  if (deleted.length + prune.length > MAX) return NextResponse.json({ error: "多すぎます" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "ログインしていません" }, { status: 401 });

  // 見られる画像の情報（消した印が付いたものも見られる）
  const ids = [...new Set([...deleted, ...prune.map((p) => p.id)])];
  const { data, error } = await supabase
    .from("synced_rows")
    .select("id,box_id,deleted,uploadedBy:data->>uploadedBy,rev:data->>rev")
    .eq("tbl", "media")
    .in("id", ids)
    .returns<Row[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = new Map(data.map((r) => [r.id, r]));

  const remove: string[] = [];
  // 完全に削除した画像：消した印が付いていて、入れた本人だけ
  for (const id of deleted) {
    const r = rows.get(id);
    if (!r?.deleted || r.uploadedBy !== auth.user.id) continue;
    remove.push(...((await listMediaKeys(id)) ?? []));
  }
  // 前の版：今の rev と同じで、編集できるボックスの画像だけ
  const editable = new Map<string, boolean>();
  for (const p of prune) {
    const r = rows.get(p.id);
    if (!r || r.deleted || Number(r.rev ?? 0) !== p.rev) continue;
    if (!editable.has(r.box_id)) editable.set(r.box_id, (await supabase.rpc("can_edit_box", { target: r.box_id })).data === true);
    if (!editable.get(r.box_id)) continue;
    const keys = (await listMediaKeys(p.id)) ?? [];
    remove.push(...keys.filter((k) => k.split("/")[2] !== String(p.rev)));
  }
  const failed = await deleteKeys(remove);
  return NextResponse.json({ removed: remove.length - failed, failed });
}
