/**
 * ノートの本文を、ブロック（いちばん外の階層）ごとにまとめる（3方向のまとめ）。
 * base：前にそろえたときの本文、local：自分の今の本文、remote：ほかの人が保存した本文。
 * - 自分が直した・足したブロックは、自分の内容を残す
 * - 自分が消したブロックは、消したままにする
 * - それ以外は、ほかの人の本文（順番・追加・削除・中身）に合わせる
 * 子のブロック（入れ子）は、外のブロックの中身としてまとめて比べる
 */
type Block = { id?: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeBlocks<T extends Block>(base: T[], local: T[], remote: T[]): T[] {
  const baseById = new Map(base.map((b) => [b.id, b]));
  const localIds = new Set(local.map((b) => b.id));
  const changed = new Map(local.filter((b) => !baseById.has(b.id) || !same(baseById.get(b.id), b)).map((b) => [b.id, b]));
  const deleted = new Set(base.filter((b) => !localIds.has(b.id)).map((b) => b.id));

  // ほかの人の本文を土台に、自分が消したものを外し、自分が直したものを入れ替える
  const out: T[] = remote.filter((b) => !deleted.has(b.id)).map((b) => changed.get(b.id) ?? b);

  // 自分が足したブロック（ほかの人の本文に無いもの）は、自分の本文で直前にあったブロックの後ろに入れる
  local.forEach((b, i) => {
    if (out.some((x) => x.id === b.id)) return;
    if (baseById.has(b.id) && !changed.has(b.id)) return; // ほかの人が消した、自分は触っていないブロック
    const prev = local
      .slice(0, i)
      .reverse()
      .find((p) => out.some((x) => x.id === p.id));
    const at = prev ? out.findIndex((x) => x.id === prev.id) + 1 : 0;
    out.splice(at, 0, b);
  });
  return out;
}
