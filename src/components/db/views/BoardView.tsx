"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ThumbImage } from "@/components/ThumbImage";
import { promptText } from "@/components/ui/overlay";
import { createBlankPage, updatePageValue } from "@/lib/local/requests";
import { valueOf } from "@/lib/requests/logic";
import { visibleProps } from "../editors";
import { usePeek } from "../PageLink";
import { useSaveView } from "../viewSave";
import { PropValue } from "../values";
import { Empty, PageName, type ViewProps } from "./common";
import { GroupHead, colorHueOf, groupPages, groupPropOf, groupSumText, tintOf, useCollapsed } from "./groups";

/**
 * ステータスなどの選択肢ごとに列を作り、カードをドラッグして動かす（かんばん）。
 * 列の見出しに件数と合計（ビューの設定の「合計する項目」）。列は見出しをドラッグして並べ替えられる（固定したビューではできない）。
 * カードには表紙の画像（ビューの設定で選んだメディアの項目）と、色分けの色を付けられる
 */
export function BoardView({ database, view, pages, members, userId, compact }: ViewProps) {
  const peek = usePeek();
  const saveView = useSaveView();
  const group = groupPropOf(database, view);
  const [over, setOver] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const collapsed = useCollapsed();
  const shown = visibleProps(database, view).filter((p) => p.id !== group?.id);
  const cover = database.props.find((p) => p.id === view.options.cover && p.type === "media");
  const locked = !!view.options.locked;
  if (!group) return <Empty>ボードにするには、「選択」か「ステータス」の項目が必要です。ビューの設定から選んでください。</Empty>;
  // カードを動かして値を変えられる列（選択・ステータス・ユーザー・チェックボックス）。いくつも選べる項目や工程は、動かしても値は変えない
  const movable = group.type === "select" || group.type === "status" || group.type === "user" || group.type === "checkbox";
  const columns = groupPages(group, pages, view, members);

  /** 列を並べ替える（落とした列の前に入れる） */
  const moveColumn = (from: string, to: string) => {
    const keys = columns.map((c) => c.key);
    const next = keys.filter((k) => k !== from);
    next.splice(next.indexOf(to), 0, from);
    void saveView({ ...view, options: { ...view.options, groupOrder: next } });
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const closed = collapsed.isClosed(col.key);
        return (
          <div
            key={col.key || "__none"}
            data-name={`ボードの列「${col.label}」`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              // 列の見出しを落としたとき：列の並べ替え
              if (dragCol !== null) {
                const from = dragCol;
                setDragCol(null);
                if (from !== col.key && !locked) moveColumn(from, col.key);
                return;
              }
              const id = e.dataTransfer.getData("text/page-id");
              if (id && movable) void updatePageValue(id, group.id, group.type === "checkbox" ? col.key === "true" : col.key);
            }}
            className={`flex shrink-0 flex-col gap-1.5 rounded-[12px] p-1.5 transition ${closed ? "w-44" : "w-64"} ${over === col.key ? "bg-tint" : "bg-line/30"} ${dragCol === col.key ? "opacity-50" : ""}`}
          >
            {/* 列の見出し：押すとたたむ。ドラッグで列を並べ替え */}
            <div
              draggable={!locked}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/board-col", col.key);
                setDragCol(col.key);
              }}
              onDragEnd={() => setDragCol(null)}
              className={locked ? "" : "cursor-grab active:cursor-grabbing"}
              title={locked ? undefined : "ドラッグで列を並べ替え"}
            >
              <GroupHead group={col} sum={groupSumText(database, view, col.pages)} collapsed={closed} onToggle={() => collapsed.toggle(col.key)} />
            </div>
            {!closed &&
              col.pages.map((p) => {
                const hue = colorHueOf(database, view, p);
                const images = cover ? valueOf(p, cover.id) : undefined;
                const first = Array.isArray(images) ? (images[0] as string | undefined) : undefined;
                return (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/page-id", p.id)}
                    onClick={() => peek(database, p.id)}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && peek(database, p.id)}
                    className="cursor-pointer overflow-hidden rounded-[10px] border border-line bg-card shadow-sm hover:brightness-[0.97]"
                    // 色分け：左の端に色の線と、うすい背景
                    style={hue ? { borderLeft: `4px solid ${hue}`, background: tintOf(hue, 10) } : undefined}
                  >
                    {first && (
                      <div className="aspect-[16/9] bg-line/30">
                        <ThumbImage id={first} alt="" />
                      </div>
                    )}
                    <div className={`space-y-1 ${compact ? "p-2" : "p-2.5"}`}>
                      <PageName database={database} page={p} className="font-bold" />
                      {shown.map((sp) => {
                        const v = valueOf(p, sp.id);
                        return v === undefined || v === "" || v === null ? null : (
                          <div key={sp.id} className="text-sm">
                            <PropValue prop={sp} value={v} members={members} page={p} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            {!closed && movable && col.key !== "" && (
              <button
                onClick={async () => {
                  const title = await promptText(`「${col.label}」に追加`, "", "名前");
                  if (!title) return;
                  const page = await createBlankPage(database, userId, { [group.id]: group.type === "checkbox" ? col.key === "true" : col.key }, title);
                  peek(database, page.id);
                }}
                className="flex items-center gap-1 rounded-[8px] px-2 py-1 text-sm text-muted hover:bg-tint"
              >
                <Icon name="add" size={16} />
                新規
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
