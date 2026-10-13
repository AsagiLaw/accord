"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { choose, toast } from "@/components/ui/overlay";
import { setLibraryMembers } from "@/lib/local/media";
import { arrange, descendants } from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import { useMediaState } from "./MediaContext";
import { ThumbImage } from "./Thumb";

type Filter = "all" | "hideIn" | "onlyIn";

/** ライブラリーに入れる画像を選ぶ。選択を外した画像はライブラリーから出る */
export function AddToLibraryDialog({ libId }: { libId: string }) {
  const { media, libs, boxId, setAddingTo } = useMediaState();
  const prefs = useMediaPrefs();
  const lib = libs.find((l) => l.id === libId)!;
  const [before] = useState(() =>
    media
      .filter((m) => !m.trashed && m.libIds.includes(libId))
      .map((m) => m.id),
  );
  const [chosen, setChosen] = useState<string[]>(before);
  const [filter, setFilter] = useState<Filter>("all");
  const changed =
    chosen.length !== before.length || chosen.some((x) => !before.includes(x));
  const list = arrange(
    media.filter(
      (m) =>
        !m.trashed &&
        (filter === "hideIn"
          ? !before.includes(m.id)
          : filter === "onlyIn"
            ? before.includes(m.id)
            : true),
    ),
    prefs,
  );
  const close = () => setAddingTo(null);

  const done = async () => {
    const below = descendants(libs, libId).filter((x) => x !== libId);
    const leaving = media.filter(
      (m) => before.includes(m.id) && !chosen.includes(m.id),
    );
    const alsoFrom = [
      ...new Set(
        leaving.flatMap((m) => m.libIds.filter((x) => below.includes(x))),
      ),
    ]
      .map((x) => libs.find((l) => l.id === x)?.name)
      .filter(Boolean);
    if (alsoFrom.length) {
      const i = await choose(
        `「${lib.name}」から外します`,
        [{ label: "外す", danger: true }],
        `「${alsoFrom.join("」「")}」からも外れますが、よろしいですか？`,
      );
      if (i !== 0) return;
    }
    const added = chosen.filter((x) => !before.includes(x)).length;
    const removed = leaving.length;
    const undo = await setLibraryMembers(boxId, libId, chosen);
    close();
    toast(
      `${[added && `${added}枚を追加`, removed && `${removed}枚を除外`].filter(Boolean).join("、")}しました`,
      { label: "元に戻す", run: () => void undo() },
    );
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`「${lib.name}」に画像を追加`}
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="truncate font-bold">「{lib.name}」に画像を追加</h3>
          <div className="flex shrink-0 gap-2">
            <button className="btn-sub" onClick={close}>
              キャンセル
            </button>
            <button className="btn" disabled={!changed} onClick={done}>
              完了
            </button>
          </div>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-sm text-muted">
            選んだ画像がライブラリーに入ります。選択を外すと、ライブラリーから外れます。
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "全て表示"],
                ["hideIn", "追加済みを隠す"],
                ["onlyIn", "追加済みのみ"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                className={filter === v ? "btn" : "btn-sub"}
                onClick={() => setFilter(v)}
              >
                {label}
              </button>
            ))}
          </div>
          {list.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
              {list.map((m) => {
                const on = chosen.includes(m.id);
                return (
                  <button
                    key={m.id}
                    aria-pressed={on}
                    aria-label={m.name}
                    onClick={() =>
                      setChosen(
                        on
                          ? chosen.filter((x) => x !== m.id)
                          : [...chosen, m.id],
                      )
                    }
                    className={`relative aspect-square overflow-hidden rounded-[10px] border ${on ? "border-accent ring-2 ring-accent" : "border-line"}`}
                  >
                    <ThumbImage id={m.id} alt={m.name} />
                    <span
                      className={`absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full border-2 ${on ? "border-accent bg-accent text-accent-ink" : "border-white bg-black/30"}`}
                    >
                      {on && <Icon name="ok" size={14} />}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted">画像がありません</p>
          )}
        </div>
      </div>
    </div>
  );
}
