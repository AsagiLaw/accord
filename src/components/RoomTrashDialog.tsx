"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { daysLeft } from "@/components/db/TrashDialog";
import { Icon } from "@/components/Icon";
import { DEFAULT_PAGE_ICON, IconMark } from "@/components/IconMark";
import { PopupDialog } from "@/components/ui/Dialog";
import { confirmAction } from "@/components/ui/overlay";
import { deleteDatabase, deleteNoteTree } from "@/lib/local/channels";
import { restoreInlineDb } from "@/lib/local/inlineDbs";
import { restoreSubNote } from "@/lib/local/notes";
import { TRASH_DAYS, deletePageForever, emptyRoomTrash, restorePage, useRoomTrash, type RoomTrashItem } from "@/lib/local/requests";

const rawTitle = (item: RoomTrashItem) => (item.kind === "note" ? item.note.title : item.kind === "page" ? item.page.title : item.database.name);
const titleOf = (item: RoomTrashItem) => rawTitle(item) || "無題";
const keyOf = (item: RoomTrashItem) => `${item.kind}:${item.kind === "note" ? item.note.id : item.kind === "page" ? item.page.id : item.database.id}`;

/**
 * ルームのゴミ箱（ルーム名のメニューから開く。Notion のゴミ箱と同じ）：ノートの子のページと、データベースのページ、ノートの中のデータベースをまとめて出す。
 * 押すとそのページを開き（ゴミ箱の帯が出る）、戻すか完全に削除できる。入れてから TRASH_DAYS 日たったものは、アプリを開いたときに消える
 */
export function RoomTrashDialog({ roomId, userId, onClose }: { roomId: string; userId: string; onClose: () => void }) {
  const items = useRoomTrash(roomId);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = items?.filter((i) => !q || titleOf(i).toLowerCase().includes(q));

  const open = (item: RoomTrashItem) => {
    onClose();
    router.push(
      item.kind === "note" ? `/r/${roomId}/note/${item.note.id}` : item.kind === "page" ? `/r/${roomId}/db/${item.page.dbId}/p/${item.page.id}` : `/r/${roomId}/db/${item.database.id}`,
    );
  };
  const restore = (item: RoomTrashItem) =>
    void (item.kind === "note" ? restoreSubNote(item.note, userId) : item.kind === "page" ? restorePage(item.page.id) : restoreInlineDb(item.database, userId));
  const remove = async (item: RoomTrashItem) => {
    const body =
      item.kind === "note"
        ? "中のページと、中に置いたチャットの発言も消えます。元に戻せません。"
        : item.kind === "database"
          ? "中のページと、チャットの発言も消えます。元に戻せません。"
          : "チャットの発言も消えます。元に戻せません。";
    if (!(await confirmAction(`「${titleOf(item)}」を完全に削除します`, "完全に削除", body))) return;
    await (item.kind === "note" ? deleteNoteTree(item.note.id) : item.kind === "page" ? deletePageForever(item.page) : deleteDatabase(item.database.id));
  };

  return (
    <PopupDialog title="ゴミ箱" note={`入れてから${TRASH_DAYS}日たつと、完全に削除されます`} onClose={onClose} width="max-w-xl">
      <div className="space-y-1 text-sm" data-name="ルームのゴミ箱">
        {items === undefined ? (
          <p className="loading text-muted">読み込み中…</p>
        ) : !items.length ? (
          <p className="text-muted">ゴミ箱は空です</p>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[8px] border border-line bg-card px-2 focus-within:border-accent">
                <Icon name="search" size={15} className="shrink-0 text-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="ゴミ箱のページを検索"
                  placeholder="ゴミ箱のページを検索"
                  className="min-w-0 flex-1 bg-transparent outline-none"
                />
              </label>
              <span className="shrink-0 text-xs text-muted">{items.length}件</span>
              <button
                className="shrink-0 rounded-[8px] px-2 py-1 text-xs text-warn hover:bg-tint"
                onClick={async () => {
                  if (await confirmAction("ゴミ箱を空にします", "完全に削除", `${items.length}件のページと、その中のページ・チャットの発言が消えます。元に戻せません。`)) await emptyRoomTrash(roomId);
                }}
              >
                ゴミ箱を空にする
              </button>
            </div>
            {!shown?.length && <p className="px-1 py-2 text-muted">見つかりません</p>}
            {shown?.map((item) => {
              const title = titleOf(item);
              const where =
                item.kind !== "page"
                  ? item.parent
                    ? `ノート「${item.parent.title || "無題"}」`
                    : "ノート"
                  : item.database
                    ? `データベース「${item.database.name || "無題"}」`
                    : "データベース";
              return (
                <div key={keyOf(item)} className="flex min-h-12 items-center gap-2 rounded-[10px] border border-line px-2 py-1">
                  <button type="button" onClick={() => open(item)} title="開く" className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] px-1 py-1 text-left hover:bg-tint">
                    <span className="grid w-5 shrink-0 place-items-center text-base leading-none">
                      {item.kind === "note" ? (
                        <IconMark icon={item.note.icon} fallback={<Icon name="note" size={16} />} />
                      ) : item.kind === "page" ? (
                        <IconMark icon={item.page.icon || DEFAULT_PAGE_ICON} />
                      ) : (
                        <IconMark icon={item.database.icon} fallback={<Icon name="db" size={16} />} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${rawTitle(item) ? "" : "text-muted"}`}>{title}</span>
                      <span className="block truncate text-xs text-muted">{where}</span>
                    </span>
                  </button>
                  <span className="shrink-0 text-xs text-muted" title={`${new Date(item.deletedAt).toLocaleString("ja-JP")}に入れました`}>
                    あと{daysLeft(item.deletedAt)}日
                  </span>
                  <button className="btn-sub h-8 min-h-0 gap-1 px-2.5 text-xs" onClick={() => restore(item)}>
                    <Icon name="trashRestore" size={14} />
                    戻す
                  </button>
                  <button
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-warn hover:bg-tint"
                    aria-label={`「${title}」を完全に削除`}
                    title="完全に削除"
                    onClick={() => void remove(item)}
                  >
                    <Icon name="del" size={16} />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </PopupDialog>
  );
}
