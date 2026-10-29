"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/Icon";
import { PropVisibilityScreen } from "@/components/blockSettings";
import { MenuTitle, NavRow, OptionRow, SectionHead, ToggleRow } from "@/components/ui/SettingsMenu";
import { setBoxAutoName, useBox } from "@/lib/local/boxes";
import { PREVIEW_FIELDS, type PreviewField } from "@/lib/media/logic";
import { updatePrefs, useMediaPrefs } from "@/lib/media/prefs";
import { isBackdropClick } from "@/components/ui/backdrop";

const FIELD_ICON: Record<PreviewField, IconName> = {
  title: "title",
  made: "calendar",
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
 * 入れた画像の名前を自動で付けるか（今のボックスの設定。入れる人・端末に関係なく効く）と、
 * アイコン表示の画像の見せ方（標準／Windows 風）、プレビュー欄の画像の枠（元の縦横比／1:1）・詳細に出す項目と順番
 * （こちらは端末ごとに覚える）を変える
 */
export function MediaSettingsDialog({
  boxId,
  canEdit,
  onClose,
}: {
  /** 今開いているボックス（無ければ、名前の設定は出さない） */
  boxId?: string;
  /** そのボックスに画像を入れられるか（入れられなければ、名前の設定は見るだけ） */
  canEdit: boolean;
  onClose: () => void;
}) {
  const prefs = useMediaPrefs();
  const box = useBox(boxId);
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
      className="sheet-backdrop fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => isBackdropClick(e) && onClose()}
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
            {box && (
              <>
                <SectionHead label={`画像の名前（${box.name}）`} />
                <ToggleRow
                  icon="title"
                  label="名前を自動で付ける"
                  note={`「${box.name}」に入れた画像の名前を「20250101_タイトル」の形にします。入れる人や端末に関係なく、このボックスに入れた画像すべてに効きます。同じ制作日・同じタイトルが2枚以上なら「_01」から番号を付けます。フォルダごと入れたらフォルダ名がタイトルになり、名前の中の日付は前に回します${canEdit ? "" : "（見るだけのボックスなので、変えられません）"}`}
                  on={!!box.autoName}
                  disabled={!canEdit}
                  onChange={(on) => void setBoxAutoName(box.id, on)}
                />
              </>
            )}
            <SectionHead label="アイコン表示" />
            <OptionRow
              icon="gallery"
              note="画像を正方形に切り抜いて並べ、名前を画像の上に重ねます"
              selected={prefs.iconStyle === "card"}
              onClick={() => updatePrefs({ iconStyle: "card" })}
            >
              標準
            </OptionRow>
            <OptionRow
              icon="folder"
              note="Windows のフォルダの画像表示のように、画像を切り抜かずに枠へ収め、名前を画像の下に出します"
              selected={prefs.iconStyle === "explorer"}
              onClick={() => updatePrefs({ iconStyle: "explorer" })}
            >
              Windows 風
            </OptionRow>
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
