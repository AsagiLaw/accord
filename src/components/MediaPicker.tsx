"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { toast } from "@/components/ui/overlay";
import { useLibraries, useMedia, uploadFiles } from "@/lib/local/media";
import { chain, isUnsorted } from "@/lib/media/logic";
import { MEDIA_DRAG_TYPE } from "@/lib/media/export";
import { ThumbImage } from "@/components/ThumbImage";

/**
 * メディアから画像を選ぶダイアログ。チャットやノートに画像を貼るときは必ずここを通る。
 * 新しい画像もここからアップロードでき、メディアの「未整理」に入る。
 */
export function MediaPicker({
  roomId,
  userId,
  onPick,
  onClose,
  single,
  pickLabel,
}: {
  roomId: string;
  userId: string;
  onPick: (ids: string[]) => void;
  onClose: () => void;
  /** 1枚だけ選ぶ（アイコンなど）。押すと、前に選んでいたものと入れ替わる */
  single?: boolean;
  /** 決めるボタンの文字（無ければ「N枚を貼る」） */
  pickLabel?: string;
}) {
  const media = useMedia(roomId);
  const libs = useLibraries(roomId);
  const [filter, setFilter] = useState<string>("recent");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const alive = (media ?? []).filter((m) => !m.trashed).reverse();
    if (filter === "unsorted") return alive.filter(isUnsorted);
    if (filter === "fav") return alive.filter((m) => m.fav);
    if (filter.startsWith("lib:")) return alive.filter((m) => m.libIds.includes(filter.slice(4)));
    return alive;
  }, [media, filter]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const { ids, failed } = await uploadFiles(roomId, userId, files);
    setBusy(false);
    if (failed) toast(`${failed}枚は画像でないため追加できませんでした`);
    // アップロードした画像は、そのまま選んだ状態にする
    setChosen((c) => (single ? ids.slice(0, 1) : [...c, ...ids]));
    setFilter("recent");
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="メディアから選ぶ"
        className="flex max-h-[88dvh] w-full max-w-3xl flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          // メディアの画像をドラッグしてきたときは、ファイルの追加として扱わない
          if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
          upload([...e.dataTransfer.files]);
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="font-bold">メディアから選ぶ</h3>
          <div className="flex gap-2">
            <button className="btn-sub" onClick={onClose}>
              キャンセル
            </button>
            <button className="btn" disabled={!chosen.length} onClick={() => onPick(chosen)}>
              {pickLabel ?? (chosen.length ? `${chosen.length}枚を貼る` : "貼る")}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2">
          <label className={`btn-sub cursor-pointer ${busy ? "opacity-50" : ""}`}>
            <Icon name="upload" />
            {busy ? "読み込み中…" : "新しくアップロード"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                upload(files);
              }}
            />
          </label>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="field w-auto" aria-label="表示する画像">
            <option value="recent">新しい順にすべて</option>
            <option value="unsorted">未整理</option>
            <option value="fav">お気に入り</option>
            {(libs ?? []).length > 0 && (
              <optgroup label="ライブラリー">
                {(libs ?? []).map((l) => (
                  <option key={l.id} value={`lib:${l.id}`}>
                    {chain(libs ?? [], l.id)
                      .map((x) => x.name)
                      .join(" / ")}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {list.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
              {list.map((m) => {
                const i = chosen.indexOf(m.id);
                return (
                  <button
                    key={m.id}
                    aria-pressed={i >= 0}
                    aria-label={m.name}
                    onClick={() => setChosen(i >= 0 ? chosen.filter((x) => x !== m.id) : single ? [m.id] : [...chosen, m.id])}
                    className={`relative aspect-square overflow-hidden rounded-[10px] border ${i >= 0 ? "border-accent ring-2 ring-accent" : "border-line"}`}
                  >
                    <ThumbImage id={m.id} alt={m.name} />
                    {i >= 0 && (
                      <span className="absolute top-1.5 left-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-accent-ink">
                        {i + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted">画像がありません。「新しくアップロード」か、ここに画像をドラッグしてください。</p>
          )}
        </div>
      </div>
    </div>
  );
}
