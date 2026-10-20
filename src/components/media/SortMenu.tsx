"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { PropVisibilityScreen } from "@/components/blockSettings";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { NavRow, ToggleRow } from "@/components/ui/SettingsMenu";
import {
  LIST_COLUMNS,
  type ListColumn,
  type LibMode,
  type SortKey,
} from "@/lib/media/logic";
import { updatePrefs, useMediaPrefs } from "@/lib/media/prefs";

const SORT_LABEL: Record<SortKey, string> = {
  new: "追加日時",
  made: "制作日",
  name: "名前",
  size: "容量",
};

// 下向きの矢印にする並び順（上から下へ自然に読める方）：日時は新しい順、名前は A→Z 順、容量は大きい順
const DOWN_ARROW: Record<SortKey, "asc" | "desc"> = {
  new: "desc",
  made: "desc",
  name: "asc",
  size: "desc",
};

const DIR_LABEL: Record<SortKey, { desc: string; asc: string }> = {
  new: { desc: "新しい順", asc: "古い順" },
  made: { desc: "新しい順", asc: "古い順" },
  name: { desc: "Z→A順", asc: "A→Z順" },
  size: { desc: "大きい順", asc: "小さい順" },
};

const COLUMN_ICON: Record<ListColumn, IconName> = {
  fileName: "text",
  type: "tag",
  dims: "img",
  dpi: "hash",
  pixels: "hash",
  ratio: "expand",
  size: "hash",
  made: "calendar",
  date: "calendar",
  uploader: "person",
  libs: "folder",
};

const LIB_MODES: { v: LibMode; label: string; note: string }[] = [
  { v: "rep", label: "基本", note: "子ライブラリーは代表の画像だけを出します" },
  { v: "all", label: "全て表示", note: "子ライブラリーの画像もすべて出します" },
  {
    v: "single",
    label: "シングル",
    note: "子ライブラリーに入っていない画像だけを出します",
  },
];

/** iconOnly：サムネイルを並べる見せ方しかない所（メディアから選ぶ画面）。「画像・ライブラリーの表示」を出さない */
export function SortMenu({ showLibMode, iconOnly }: { showLibMode: boolean; iconOnly?: boolean }) {
  const prefs = useMediaPrefs();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // 「詳細の表示/非表示」の画面に進んでいる（データベースのビューの設定と同じく、中の画面に切り替わる）
  const [screen, setScreen] = useState<"top" | "columns">("top");

  useEffect(() => {
    if (!open) return;
    // 基準のメニュー（画面の別の場所に出る）を押したときは閉じない
    const close = (e: MouseEvent) =>
      !ref.current?.contains(e.target as Node) &&
      !(e.target as Element).closest?.("[data-nested-popover]") &&
      setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        className="btn-sub w-10 px-0"
        aria-label="並べ替えと表示"
        aria-expanded={open}
        title="並べ替えと表示"
        onClick={() => {
          setOpen((v) => !v);
          setScreen("top");
        }}
      >
        <Icon name="sort" />
      </button>
      {open && (
        <div
          role="dialog"
          data-name="並べ替えと表示のメニュー"
          aria-label="並べ替えと表示"
          className={`absolute top-12 right-0 z-30 w-72 rounded-[14px] border border-line bg-card shadow-xl ${screen === "top" ? "space-y-3 p-4" : "p-2 text-sm"}`}
        >
          {screen === "columns" ? (
            <PropVisibilityScreen
              all={LIST_COLUMNS}
              shown={prefs.columns
                .map((c) => LIST_COLUMNS.find((x) => x.id === c))
                .filter((x) => x !== undefined)}
              onSave={(ids) => updatePrefs({ columns: ids as ListColumn[] })}
              onBack={() => setScreen("top")}
              noun="詳細"
              icon={(c) => (
                <Icon
                  name={COLUMN_ICON[c.id]}
                  size={14}
                  className="shrink-0 text-muted"
                />
              )}
            />
          ) : (
            <>
              <section className="space-y-2">
                <h4 className="text-sm font-bold">並べる基準</h4>
                {/* 基準はドロップダウンで選び、右のボタンで昇順・降順を切り替える */}
                <div className="flex items-center gap-2">
                  <Select
                    value={prefs.sort}
                    label="並べる基準"
                    className="flex-1"
                    options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ value: k, label: SORT_LABEL[k] }))}
                    onChange={(k) => {
                      // 基準を変えても、矢印の向き（上向き・下向き）はそのまま
                      const down =
                        prefs.dirs[prefs.sort] === DOWN_ARROW[prefs.sort];
                      const dir = down
                        ? DOWN_ARROW[k]
                        : DOWN_ARROW[k] === "asc"
                          ? "desc"
                          : "asc";
                      updatePrefs({
                        sort: k,
                        dirs: { ...prefs.dirs, [k]: dir },
                      });
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`並び順：${DIR_LABEL[prefs.sort][prefs.dirs[prefs.sort]]}（押すと${DIR_LABEL[prefs.sort][prefs.dirs[prefs.sort] === "asc" ? "desc" : "asc"]}）`}
                    title={`${DIR_LABEL[prefs.sort][prefs.dirs[prefs.sort]]}（押すと切り替え）`}
                    onClick={() =>
                      updatePrefs({
                        dirs: {
                          ...prefs.dirs,
                          [prefs.sort]:
                            prefs.dirs[prefs.sort] === "asc" ? "desc" : "asc",
                        },
                      })
                    }
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-line text-ink hover:bg-tint"
                  >
                    <Icon
                      name={
                        DOWN_ARROW[prefs.sort] === prefs.dirs[prefs.sort]
                          ? "sortDesc"
                          : "sortAsc"
                      }
                      size={20}
                    />
                  </button>
                </div>
                <p className="text-xs text-muted">
                  {DIR_LABEL[prefs.sort][prefs.dirs[prefs.sort]]}
                </p>
              </section>
              {!iconOnly && (
              <section className="space-y-2">
                <h4 className="text-sm font-bold">画像・ライブラリーの表示</h4>
                {/* 文字ではなくアイコンで選ぶ（サムネイルを並べる／1行に1枚） */}
                <Segmented
                  value={prefs.imageView}
                  onChange={(imageView) => updatePrefs({ imageView })}
                  label="画像・ライブラリーの表示"
                  className="w-full"
                  items={[
                    { value: "icon", label: "アイコン表示", icon: "gallery" },
                    { value: "list", label: "リスト表示", icon: "list" },
                  ]}
                />
                {/* Windows のエクスプローラーと同じ：画像の名前の後ろに拡張子を付けて出す */}
                <div className="-mx-2">
                  <ToggleRow
                    icon="text"
                    label="ファイル名拡張子"
                    note="画像の名前の後ろに .jpg や .png を付けて出します"
                    on={prefs.showExt}
                    onChange={(showExt) => updatePrefs({ showExt })}
                  />
                </div>
                {/* リストで名前の右に出す列：データベースのプロパティの表示/非表示と同じ画面で選ぶ（「詳細の表示/非表示」） */}
                {prefs.imageView === "list" && (
                  <div className="-mx-2">
                    <NavRow
                      icon="eye"
                      label="詳細の表示/非表示"
                      value={`${prefs.columns.length}個を表示`}
                      onClick={() => setScreen("columns")}
                    />
                  </div>
                )}
              </section>
              )}
              <section className="space-y-1">
                <h4 className="text-sm font-bold">画像のサイズ</h4>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={prefs.level}
                  onChange={(e) =>
                    updatePrefs({ level: Number(e.target.value) })
                  }
                  aria-label="画像のサイズ"
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between text-xs text-muted">
                  {["極小", "小", "中", "大"].map((l, i) => (
                    <span
                      key={l}
                      className={
                        prefs.level === i + 1 ? "font-bold text-ink" : ""
                      }
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </section>
              {showLibMode && (
                <section className="space-y-1">
                  <h4 className="text-sm font-bold">ライブラリーの表示</h4>
                  {LIB_MODES.map((o) => (
                    <button
                      key={o.v}
                      aria-pressed={prefs.libMode === o.v}
                      title={o.note}
                      onClick={() => updatePrefs({ libMode: o.v })}
                      className={`grid w-full justify-items-start rounded-[10px] px-3 py-1.5 text-left ${
                        prefs.libMode === o.v ? "bg-tint" : "hover:bg-tint"
                      }`}
                    >
                      <span className="flex items-center gap-1 text-sm font-bold">
                        {prefs.libMode === o.v && <Icon name="ok" size={14} />}
                        {o.label}
                      </span>
                    </button>
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
