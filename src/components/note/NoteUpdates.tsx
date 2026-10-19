"use client";

import { Icon } from "@/components/Icon";
import { Popover, usePopover } from "@/components/ui/Popover";
import type { Note } from "@/lib/local/db";
import type { MemberWithProfile } from "@/lib/local/rooms";

const when = (t: number) => new Date(t).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * ノートの上部バーの通知ボタン。押すと、最終更新（だれが・いつ）と作成日を出す。
 * 「更新あり」の印は、サイドバーのノートの行にだけ出す（ノートを開くと消える）
 */
export function NoteUpdatesButton({ note, members, meId }: { note: Note; members: MemberWithProfile[]; meId: string }) {
  const pop = usePopover();
  const name = (id: string) => (id === meId ? "自分" : (members.find((m) => m.userId === id)?.displayName ?? "—"));

  const label = "ノートの更新";
  return (
    <>
      <button
        type="button"
        data-name="ノートの更新"
        aria-label={label}
        title={label}
        aria-expanded={!!pop.anchor}
        onClick={pop.toggle}
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-[8px] hover:bg-tint md:h-7 md:w-7 hover:text-ink ${pop.anchor ? "bg-tint text-ink" : "text-muted"}`}
      >
        <Icon name="bell" size={18} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={260} align="end" label="ノートの更新">
          <div className="space-y-2 p-2 text-sm">
            <div>
              <p className="text-xs text-muted">最終更新</p>
              <p>
                <b>{name(note.updatedBy)}</b>
                <span className="ml-2 text-muted">{when(note.updatedAt)}</span>
              </p>
            </div>
            <div className="border-t border-line pt-2">
              <p className="text-xs text-muted">作成</p>
              <p className="text-muted">{when(note.createdAt)}</p>
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
