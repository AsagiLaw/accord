"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { promptText } from "@/components/ui/overlay";
import { createPage, newPageDefaults, updatePageValue } from "@/lib/local/requests";
import { valueOf } from "@/lib/requests/logic";
import { visibleProps } from "../editors";
import { Tag, colorOf } from "../meta";
import { PropValue } from "../values";
import { Empty, PageName, pageHref, type ViewProps } from "./common";

/** ステータスなどの選択肢ごとに列を作り、カードをドラッグして動かす（かんばん） */
export function BoardView({ database, view, pages, members, userId, compact }: ViewProps) {
  const router = useRouter();
  const group = database.props.find((p) => p.id === view.options.group) ?? database.props.find((p) => p.type === "status") ?? database.props.find((p) => p.type === "select");
  const [over, setOver] = useState<string | null>(null);
  const shown = visibleProps(database, view).filter((p) => p.id !== group?.id);
  if (!group) return <Empty>ボードにするには、「選択」か「ステータス」の項目が必要です。ビューの設定から選んでください。</Empty>;

  const columns = [...(group.options ?? []), ""];
  const pagesIn = (col: string) => pages.filter((p) => String(valueOf(p, group.id) ?? "") === col || (col === "" && !(group.options ?? []).includes(String(valueOf(p, group.id) ?? ""))));

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const list = pagesIn(col);
        if (col === "" && !list.length) return null;
        return (
          <div
            key={col || "__none"}
            data-name={`ボードの列「${col || "なし"}」`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/page-id");
              if (id) void updatePageValue(id, group.id, col);
            }}
            className={`flex w-64 shrink-0 flex-col gap-1.5 rounded-[12px] p-1.5 transition ${over === col ? "bg-tint" : "bg-line/30"}`}
          >
            <div className="flex items-center gap-2 px-1 py-1">
              {col ? <Tag color={colorOf(group, col)}>{col}</Tag> : <span className="text-sm text-muted">{group.name}なし</span>}
              <span className="text-xs text-muted">{list.length}</span>
            </div>
            {list.map((p) => (
              <div
                key={p.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/page-id", p.id)}
                onClick={() => router.push(pageHref(database, p.id))}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && router.push(pageHref(database, p.id))}
                className={`cursor-pointer space-y-1 rounded-[10px] border border-line bg-card shadow-sm hover:bg-tint ${compact ? "p-2" : "p-2.5"}`}
              >
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
            ))}
            {col !== "" && (
              <button
                onClick={async () => {
                  const title = await promptText(`「${col}」に追加`, "", "名前");
                  if (!title) return;
                  const page = await createPage(database, userId, title, { ...newPageDefaults(database), [group.id]: col });
                  router.push(pageHref(database, page.id));
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
