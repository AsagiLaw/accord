"use client";

import { Icon } from "@/components/Icon";
import { PopupDialog } from "@/components/ui/Dialog";
import { confirmAction } from "@/components/ui/overlay";
import type { Database } from "@/lib/local/db";
import { TRASH_DAYS, deletePageForever, emptyTrash, restorePage, useTrash } from "@/lib/local/requests";
import { PageName } from "./views/common";

/** あと何日でゴミ箱から消えるか */
export const daysLeft = (deletedAt: number) => Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * 864e5 - Date.now()) / 864e5));

/** データベースのゴミ箱：入れたページを戻すか、完全に削除する。入れてから30日たったものは、アプリを開いたときに消える */
export function TrashDialog({ database, onClose }: { database: Database; onClose: () => void }) {
  const pages = useTrash(database.id);
  return (
    <PopupDialog title={`ゴミ箱（${database.name}）`} onClose={onClose} width="max-w-xl">
      <div className="space-y-1 text-sm" data-name="ゴミ箱">
        {pages === undefined ? (
          <p className="loading text-muted">読み込み中…</p>
        ) : !pages.length ? (
          <p className="text-muted">ゴミ箱は空です</p>
        ) : (
          <>
            <div className="mb-2 flex items-center">
              <span className="text-xs text-muted">{pages.length}件</span>
              <button
                className="ml-auto rounded-[8px] px-2 py-1 text-xs text-warn hover:bg-tint"
                onClick={async () => {
                  if (await confirmAction("ゴミ箱を空にします", "完全に削除", `${pages.length}件のページと、その中のチャットの発言が消えます。元に戻せません。`)) await emptyTrash(database.id);
                }}
              >
                ゴミ箱を空にする
              </button>
            </div>
            {pages.map((p) => (
              <div key={p.id} className="flex min-h-10 items-center gap-2 rounded-[10px] border border-line px-3 py-1.5">
                <PageName database={database} page={p} className="min-w-0 flex-1" noDue />
                <span className="shrink-0 text-xs text-muted" title={`${new Date(p.deletedAt!).toLocaleString("ja-JP")}に入れました`}>
                  あと{daysLeft(p.deletedAt!)}日
                </span>
                <button className="btn-sub h-8 min-h-0 gap-1 px-2.5 text-xs" onClick={() => void restorePage(p.id)}>
                  <Icon name="trashRestore" size={14} />
                  戻す
                </button>
                <button
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-warn hover:bg-tint"
                  aria-label={`「${p.title || "無題"}」を完全に削除`}
                  title="完全に削除"
                  onClick={async () => {
                    if (await confirmAction(`「${p.title || "無題"}」を完全に削除します`, "完全に削除", "チャットの発言も消えます。元に戻せません。")) await deletePageForever(p);
                  }}
                >
                  <Icon name="del" size={16} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </PopupDialog>
  );
}
