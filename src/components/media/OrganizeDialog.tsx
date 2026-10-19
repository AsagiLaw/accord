"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { choose, toast } from "@/components/ui/overlay";
import { Segmented } from "@/components/ui/Segmented";
import type { Library } from "@/lib/local/db";
import { organize } from "@/lib/local/media";
import { chain, childrenOf, coverOf, descendants } from "@/lib/media/logic";
import { useMediaPrefs } from "@/lib/media/prefs";
import { newLibraryFlow } from "./flows";
import { CoverCard } from "./LibraryCard";
import { useMediaState } from "./MediaContext";
import { ThumbImage } from "./Thumb";

/**
 * 「整理」：選んだ画像を入れるライブラリーを選ぶ（複数可）。
 * すでに全部の画像が入っているライブラリーは選択済みで始まり、外すとそこから出る。
 * 右下の ▸（開くと ▾）で子ライブラリーの段を開いていける。
 */
const VIEW_KEY = "irai-note:media-organize-view";

export function OrganizeDialog({ ids }: { ids: string[] }) {
  const { libs, media, byId, boxId, setOrganizing, setSelected } =
    useMediaState();
  const items = ids.map((id) => byId.get(id)).filter((m) => m !== undefined);
  const [before] = useState(() =>
    libs
      .map((l) => l.id)
      .filter(
        (id) => items.length > 0 && items.every((m) => m.libIds.includes(id)),
      ),
  );
  const [chosen, setChosen] = useState<string[]>(before);
  // 開いている段：最初は、選択済みの一番深い子ライブラリーが見えるところまで
  const [open, setOpen] = useState<string[]>(() => {
    const deepest = libs
      .filter((l) => before.includes(l.id) && l.parentId)
      .sort((a, b) => chain(libs, b.id).length - chain(libs, a.id).length)[0];
    return deepest
      ? chain(libs, deepest.id)
          .slice(0, -1)
          .map((l) => l.id)
      : [];
  });
  // 見せ方：カード（段で開く）／リスト（木の形で開く）。この画面だけの設定として端末ごとに覚える（最初は「並べ替えと表示」と同じ）
  const prefs = useMediaPrefs();
  const [view, setView] = useState<"icon" | "list">(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return v === "icon" || v === "list" ? v : prefs.imageView;
    } catch {
      return prefs.imageView;
    }
  });
  const changeView = (v: "icon" | "list") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // 覚えられなくても、この画面の間は効く
    }
  };
  // リスト表示で開いているライブラリー（最初は、カードの段と同じく選択済みの一番深い所まで）
  const [listOpen, setListOpen] = useState<string[]>(() => open);
  const changed =
    chosen.length !== before.length || chosen.some((x) => !before.includes(x));

  const close = () => setOrganizing(null);

  const toggle = async (lib: Library) => {
    if (!chosen.includes(lib.id)) {
      setChosen([...chosen, lib.id]);
      return;
    }
    // もともと入っていたライブラリーを外すと、その子ライブラリーからも外れる
    const affected = descendants(libs, lib.id)
      .filter((x) => x !== lib.id && items.some((m) => m.libIds.includes(x)))
      .map((x) => libs.find((l) => l.id === x)!)
      .filter(Boolean);
    if (before.includes(lib.id) && affected.length) {
      const i = await choose(
        `「${lib.name}」から外します`,
        [
          {
            label: "外す",
            detail: `「${lib.name}」と、その子ライブラリーから画像を外します`,
            danger: true,
          },
        ],
        `「${affected.map((l) => l.name).join("」「")}」からも外れますが、よろしいですか？`,
      );
      if (i !== 0) return;
      const drop = [lib.id, ...affected.map((l) => l.id)];
      setChosen(chosen.filter((x) => !drop.includes(x)));
      return;
    }
    setChosen(chosen.filter((x) => x !== lib.id));
  };

  const addLib = async (parent: Library | null) => {
    const lib = await newLibraryFlow(boxId, parent?.id ?? null, parent?.name);
    if (lib) setChosen((c) => [...c, lib.id]);
  };

  const card = (lib: Library, depth: number) => {
    const on = chosen.includes(lib.id);
    const expanded = open[depth] === lib.id;
    return (
      <div key={lib.id} className="w-36 shrink-0">
        <CoverCard
          name={lib.name}
          covers={coverOf(media, lib)}
          active={on}
          onClick={() => toggle(lib)}
        >
          <span
            aria-hidden
            className={`pointer-events-none absolute top-3 right-3 grid h-6 w-6 place-items-center rounded-full border-2 ${on ? "border-accent bg-accent text-accent-ink" : "border-white bg-black/30"}`}
          >
            {on && <Icon name="ok" size={14} />}
          </span>
          <button
            aria-label={`「${lib.name}」の子ライブラリーを${expanded ? "閉じる" : "開く"}`}
            aria-expanded={expanded}
            onClick={() =>
              setOpen(
                expanded
                  ? open.slice(0, depth)
                  : [...open.slice(0, depth), lib.id],
              )
            }
            className="absolute right-2 bottom-0 grid h-8 w-8 place-items-center rounded-full hover:bg-tint"
          >
            <Icon name={expanded ? "dn" : "rt"} />
          </button>
        </CoverCard>
      </div>
    );
  };

  const newCard = (parent: Library | null) => (
    <button
      onClick={() => addLib(parent)}
      className="grid aspect-[3/2] w-36 shrink-0 place-items-center self-start rounded-[12px] border border-dashed border-line text-sm text-muted hover:bg-tint"
    >
      <span className="grid place-items-center">
        <Icon name="add" size={22} />
        {parent ? "子ライブラリーを作る" : "ライブラリーを作る"}
      </span>
    </button>
  );

  // リスト表示の行：▸ で子ライブラリーを開く、行を押すと入れる・外すを選ぶ（右の丸に印が付く）
  const listRows = (pid: string | null, depth: number): React.ReactNode => (
    <>
      {childrenOf(libs, pid).map((l) => {
        const on = chosen.includes(l.id);
        const kids = childrenOf(libs, l.id).length;
        const expanded = listOpen.includes(l.id);
        const cover = coverOf(media, l)[0];
        return (
          <li key={l.id}>
            <div
              className={`flex h-7 items-center gap-0.5 rounded-[4px] pr-2 ${on ? "bg-accent/15" : "hover:bg-tint"}`}
              style={{ paddingLeft: 4 + depth * 18 }}
            >
              <span className="grid w-5 shrink-0 place-items-center">
                {kids > 0 && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={`「${l.name}」の子ライブラリーを${expanded ? "閉じる" : "開く"}`}
                    onClick={() =>
                      setListOpen(
                        expanded
                          ? listOpen.filter((x) => x !== l.id)
                          : [...listOpen, l.id],
                      )
                    }
                    className={`grid h-5 w-5 place-items-center rounded-[4px] hover:bg-card ${expanded ? "text-accent" : "text-muted"}`}
                  >
                    <Icon name={expanded ? "dn" : "rt"} size={14} />
                  </button>
                )}
              </span>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(l)}
                className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-[3px] bg-line/40 text-muted">
                  {cover ? (
                    <ThumbImage id={cover.id} alt="" />
                  ) : (
                    <Icon name="folder" size={12} />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? "border-accent bg-accent text-accent-ink" : "border-line"}`}
                >
                  {on && <Icon name="ok" size={12} />}
                </span>
              </button>
            </div>
            {expanded && <ul>{listRows(l.id, depth + 1)}</ul>}
          </li>
        );
      })}
      <li>
        <button
          type="button"
          onClick={() =>
            addLib(pid ? (libs.find((l) => l.id === pid) ?? null) : null)
          }
          className="flex h-7 w-full items-center gap-2 rounded-[4px] pr-2 text-left text-muted hover:bg-tint hover:text-ink"
          style={{ paddingLeft: 4 + depth * 18 + 22 }}
        >
          <Icon name="add" size={14} />
          {pid ? "子ライブラリーを作る" : "ライブラリーを作る"}
        </button>
      </li>
    </>
  );

  return (
    <div
      className="sheet-backdrop fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="画像を整理"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="font-bold">画像を整理（{items.length}枚）</h3>
          <div className="flex gap-2">
            <button className="btn-sub" onClick={close}>
              キャンセル
            </button>
            <button
              className="btn"
              disabled={!changed}
              onClick={async () => {
                const undo = await organize(boxId, ids, chosen, before);
                close();
                setSelected([]);
                toast(`${items.length}枚を整理しました`, {
                  label: "元に戻す",
                  run: () => void undo(),
                });
              }}
            >
              完了
            </button>
          </div>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {items.map((m) => (
              <div
                key={m.id}
                className="h-16 w-16 shrink-0 overflow-hidden rounded-md"
              >
                <ThumbImage id={m.id} alt={m.name} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold" title={`入れるライブラリーを選んでください（いくつでも）。${view === "list" ? "左の ▸" : "右下の ▸"} で子ライブラリーを開けます`}>
              入れるライブラリー
            </p>
            <Segmented
              value={view}
              onChange={changeView}
              label="ライブラリーの表示"
              items={[
                { value: "icon", label: "アイコン表示", icon: "gallery" },
                { value: "list", label: "リスト表示", icon: "list" },
              ]}
            />
          </div>
          {view === "list" ? (
            <ul
              data-name="ライブラリーのリスト（整理）"
              className="rounded-[10px] border border-line bg-card p-1 text-sm"
            >
              {listRows(null, 0)}
            </ul>
          ) : (
            <>
              <Row>
                {childrenOf(libs, null).map((l) => card(l, 0))}
                {newCard(null)}
              </Row>
              {open.map((id, depth) => {
                const lib = libs.find((l) => l.id === id);
                if (!lib) return null;
                return (
                  <div key={id}>
                    <p className="mb-1 text-sm text-muted">
                      「{lib.name}」の子ライブラリー
                    </p>
                    <Row>
                      {childrenOf(libs, id).map((l) => card(l, depth + 1))}
                      {newCard(lib)}
                    </Row>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** ライブラリーのカードの段。入りきらなければ折り返す */
function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-start gap-2">{children}</div>;
}
