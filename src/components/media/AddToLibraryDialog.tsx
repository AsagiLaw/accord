"use client";

import { useCallback, useState } from "react";
import { MediaPicker } from "@/components/MediaPicker";
import { toast } from "@/components/ui/overlay";
import type { Media } from "@/lib/local/db";
import { setLibraryMembers } from "@/lib/local/media";
import { useMediaState } from "./MediaContext";

type Filter = "all" | "hideIn" | "onlyIn";

/** ライブラリーに入れる画像を選ぶ。選択を外した画像はライブラリーから出る */
export function AddToLibraryDialog({ libId }: { libId: string }) {
  const { media, libs, boxId, me, setAddingTo } = useMediaState();
  const lib = libs.find((l) => l.id === libId)!;
  const [before] = useState(() =>
    media
      .filter((m) => !m.trashed && m.libIds.includes(libId))
      .map((m) => m.id),
  );
  const [filter, setFilter] = useState<Filter>("all");
  const show = useCallback(
    (m: Media) =>
      filter === "hideIn" ? !before.includes(m.id) : filter === "onlyIn" ? before.includes(m.id) : true,
    [filter, before],
  );
  const close = () => setAddingTo(null);

  const done = async (chosen: string[]) => {
    const leaving = media.filter(
      (m) => before.includes(m.id) && !chosen.includes(m.id),
    );
    const added = chosen.filter((x) => !before.includes(x)).length;
    const removed = leaving.length;
    const undo = await setLibraryMembers(boxId, libId, chosen);
    close();
    toast(
      `${[added && `${added}枚を追加`, removed && `${removed}枚を除外`].filter(Boolean).join("、")}しました`,
      { label: "元に戻す", run: () => void undo() },
    );
  };

  // チャットで画像を選ぶ画面と同じもの（ライブラリーの切り替え・検索・並べ替え・アップロード）。ボックスはこのボックスだけ
  return (
    <MediaPicker
      roomId=""
      userId={me.id}
      box={boxId}
      initial={before}
      title={`「${lib.name}」に画像を追加`}
      pickLabel="完了"
      filter={show}
      tools={([
        ["all", "全て表示"],
        ["hideIn", "追加済みを隠す"],
        ["onlyIn", "追加済みのみ"],
      ] as const).map(([v, label]) => (
        <button
          key={v}
          className={filter === v ? "btn" : "btn-sub"}
          onClick={() => setFilter(v)}
        >
          {label}
        </button>
      ))}
      onPick={(ids) => void done(ids)}
      onClose={close}
    />
  );
}
