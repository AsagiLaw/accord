"use client";

import type { Library, Media } from "@/lib/local/db";
import { aspectRatio, formatSize } from "@/lib/media/image";
import { chain, descendants } from "@/lib/media/logic";
import { useMediaState } from "./MediaContext";
import { ThumbImage } from "./Thumb";

/** 画像が入っているライブラリーを「親 › 子」の形で、一番深いものだけ並べる */
export function libraryPaths(m: Media, libs: Library[]): string[] {
  const inLibs = libs.filter((l) => m.libIds.includes(l.id));
  const leaves = inLibs.filter((l) => !inLibs.some((o) => o !== l && descendants(libs, l.id).includes(o.id)));
  return leaves.map((l) =>
    chain(libs, l.id)
      .map((x) => x.name)
      .join(" › "),
  );
}

export function PreviewPanel() {
  const { selected, byId, libs, members, setViewing } = useMediaState();
  const id = selected.at(-1);
  const m = id ? byId.get(id) : undefined;

  const rows: [string, React.ReactNode][] = m
    ? [
        ["ファイル名", m.fileName],
        ["形式", (m.mime.replace("image/", "") || "不明").toUpperCase()],
        ["画像サイズ", `${m.width} × ${m.height} px`],
        ["解像度", m.dpi ? `${m.dpi} dpi` : "不明"],
        ["画素数", `${((m.width * m.height) / 1e6).toFixed(2)} メガピクセル`],
        ["縦横比", aspectRatio(m.width, m.height)],
        ["ファイル容量", formatSize(m.size)],
        ["追加日時", new Date(m.createdAt).toLocaleString("ja-JP")],
        ["追加した人", members.find((x) => x.userId === m.uploadedBy)?.displayName ?? "—"],
        [
          "ライブラリー",
          libraryPaths(m, libs).length ? (
            libraryPaths(m, libs).map((p) => <div key={p}>{p}</div>)
          ) : (
            <span className="text-muted">未整理</span>
          ),
        ],
      ]
    : [];

  return (
    <aside data-name="プレビュー欄" aria-label="プレビュー" className="sticky top-20 hidden w-64 shrink-0 self-start xl:block">
      <div className="card p-4">
        <h4 className="mb-2 text-sm font-bold">
          プレビュー
          {selected.length > 1 && <span className="ml-1 font-normal text-muted">（他{selected.length - 1}枚も選択中）</span>}
        </h4>
        {!m ? (
          <p className="text-sm text-muted">画像を選ぶと、ここに詳細が出ます。</p>
        ) : (
          <>
            <button className="mb-3 block aspect-square w-full overflow-hidden rounded-[10px]" aria-label="大きく表示" onClick={() => setViewing(m.id)}>
              <ThumbImage id={m.id} alt={m.name} className="object-contain" />
            </button>
            <p className="mb-2 font-bold break-all">{m.name}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="break-all">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </aside>
  );
}
