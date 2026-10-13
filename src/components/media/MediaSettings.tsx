"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/Icon";
import { PropVisibilityScreen } from "@/components/blockSettings";
import { MenuTitle, NavRow, OptionRow, SectionHead } from "@/components/ui/SettingsMenu";
import { PREVIEW_FIELDS, type PreviewField } from "@/lib/media/logic";
import { updatePrefs, useMediaPrefs } from "@/lib/media/prefs";

const FIELD_ICON: Record<PreviewField, IconName> = {
  fileName: "text",
  type: "tag",
  dims: "img",
  dpi: "hash",
  mm: "hash",
  profile: "palette",
  pixels: "hash",
  ratio: "expand",
  size: "hash",
  date: "calendar",
  uploader: "person",
  libs: "folder",
};

/**
 * メディアの設定（サイドバーのメディアのボタンを右クリック →「メディアの設定」）。
 * プレビュー欄の画像の枠（元の縦横比／1:1）と、詳細に出す項目・順番を変える。端末ごとに覚える
 */
export function MediaSettingsDialog({ onClose }: { onClose: () => void }) {
  const prefs = useMediaPrefs();
  // 「詳細の表示/非表示」の画面に進んでいる（ほかの設定と同じく、中の画面に切り替わる）
  const [screen, setScreen] = useState<"top" | "fields">("top");
  const shown = prefs.previewFields
    .map((id) => PREVIEW_FIELDS.find((f) => f.id === id))
    .filter((f) => f !== undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // サイドバー（ぼかし・移動の効果が付いている）の外に出す。中に置くと、画面全体を覆えない
  return createPortal(
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="メディアの設定"
        data-name="メディアの設定"
        className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[20px] border border-line bg-card p-3 text-sm sm:w-80 sm:rounded-[14px]"
      >
        {screen === "fields" ? (
          <PropVisibilityScreen
            all={PREVIEW_FIELDS}
            shown={shown}
            onSave={(ids) => updatePrefs({ previewFields: ids as PreviewField[] })}
            onBack={() => setScreen("top")}
            noun="詳細"
            icon={(f) => <Icon name={FIELD_ICON[f.id]} size={14} className="shrink-0 text-muted" />}
          />
        ) : (
          <>
            <div className="flex items-center">
              <MenuTitle>メディアの設定</MenuTitle>
              <button
                aria-label="閉じる"
                onClick={onClose}
                className="ml-auto grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <SectionHead label="プレビュー欄の画像" />
            <OptionRow
              icon="img"
              note="元の画像と同じ縦横比で出します"
              selected={prefs.previewRatio === "original"}
              onClick={() => updatePrefs({ previewRatio: "original" })}
            >
              オリジナル
            </OptionRow>
            <OptionRow
              icon="img"
              note="正方形の枠に収めて出します"
              selected={prefs.previewRatio === "square"}
              onClick={() => updatePrefs({ previewRatio: "square" })}
            >
              1:1
            </OptionRow>
            <SectionHead label="プレビュー欄の詳細" />
            <NavRow
              icon="list"
              label="表示する詳細と順番"
              value={`${shown.length}個を表示`}
              onClick={() => setScreen("fields")}
            />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
