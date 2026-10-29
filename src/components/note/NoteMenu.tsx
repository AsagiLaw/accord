"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { MenuDivider, MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import { ToggleRow } from "@/components/ui/SettingsMenu";
import { confirmAction, toast } from "@/components/ui/overlay";
import { noteDescendants } from "@/lib/local/channels";
import type { Note, NoteLook } from "@/lib/local/db";
import { TRASH_DAYS } from "@/lib/local/requests";
import { deleteNote, restoreSubNote, setNoteLocked, setNoteLook, trashSubNote } from "@/lib/local/notes";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { plainText } from "./docBlocks";

const FONTS: { id: NoteLook["font"]; label: string; className: string }[] = [
  { id: undefined, label: "標準", className: "" },
  { id: "serif", label: "明朝", className: "note-font-serif" },
  { id: "mono", label: "等幅", className: "note-font-mono" },
];

type Loose = { content?: unknown; children?: Loose[] };

/** 本文の文字数（空白は数えない） */
function countChars(blocks: unknown[]): number {
  let n = 0;
  const walk = (list: Loose[]) => {
    for (const b of list) {
      n += [...plainText(b.content).replace(/\s/g, "")].length;
      if (b.children?.length) walk(b.children);
    }
  };
  walk(blocks as Loose[]);
  return n;
}

const when = (t: number) => new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * ノートの上のバーの「…」（Notion と同じ）：書体・小さい文字・全幅・ページのロック・リンクのコピー・削除。いちばん下に文字数と最後に直した人。
 * body：文字数を数える中身（テンプレートと繋いだノートは、テンプレートの中身）。
 * 子のページの削除はゴミ箱へ（親の本文の「ページ」ブロックも外す。Notion と同じ）。チャンネルのノートは、中の子のページごと完全に削除する
 */
export function NoteMenu({ note, body, roomId, userId, members, linked }: { note: Note; body: Note; roomId: string; userId: string; members: MemberWithProfile[]; linked: boolean }) {
  const pop = usePopover();
  const router = useRouter();
  const look = note.look ?? {};
  const editor = members.find((m) => m.userId === body.updatedBy)?.displayName;
  return (
    <>
      <button
        type="button"
        onClick={pop.toggle}
        aria-label="このノートのメニュー"
        title="スタイル・ロック・削除など"
        aria-expanded={!!pop.anchor}
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-[8px] md:h-7 md:w-7 ${pop.anchor ? "bg-tint text-ink" : "text-muted hover:bg-tint hover:text-ink"}`}
      >
        <Icon name="dots" size={18} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={260} align="end" label="このノート">
          <div className="grid grid-cols-3 gap-1 p-1" role="radiogroup" aria-label="書体">
            {FONTS.map((f) => {
              const on = look.font === f.id;
              return (
                <button
                  key={f.label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => void setNoteLook(note.id, { font: f.id })}
                  className={`flex flex-col items-center gap-0.5 rounded-[8px] py-1.5 hover:bg-tint ${on ? "text-accent" : "text-ink"}`}
                >
                  <span className={`text-2xl leading-tight ${f.className}`}>あA</span>
                  <span className={`text-xs ${on ? "font-bold" : "text-muted"}`}>{f.label}</span>
                </button>
              );
            })}
          </div>
          <MenuDivider />
          <ToggleRow icon="text" label="小さい文字" on={!!look.small} onChange={(small) => void setNoteLook(note.id, { small })} />
          <ToggleRow icon="fullscreen" label="全幅" note="本文を画面の幅いっぱいに広げる" on={!!look.full} onChange={(full) => void setNoteLook(note.id, { full })} />
          {!linked && <ToggleRow icon="lock" label="ページをロック" note="ロックを外すまで、だれも本文を直せない" on={!!note.locked} onChange={(on) => void setNoteLocked(note.id, on)} />}
          <MenuDivider />
          <MenuItem
            icon={<Icon name="link" size={16} />}
            onClick={() => {
              pop.close();
              navigator.clipboard.writeText(`${location.origin}/r/${roomId}/note/${note.id}`).then(
                () => toast("リンクをコピーしました"),
                () => toast("リンクをコピーできませんでした"),
              );
            }}
          >
            リンクをコピー
          </MenuItem>
          <MenuItem
            icon={<Icon name="del" size={16} />}
            danger
            onClick={async () => {
              pop.close();
              const name = note.title || "無題";
              if (note.parentId) {
                router.push(`/r/${roomId}/note/${note.parentId}`);
                await trashSubNote(note, userId);
                toast(`「${name}」をゴミ箱に入れました（${TRASH_DAYS}日後に完全に削除）`, { label: "元に戻す", run: () => void restoreSubNote(note, userId) });
                return;
              }
              const subs = (await noteDescendants(note.id)).length;
              if (!(await confirmAction(`「${name}」を削除します`, "削除", `${subs ? `中のページ（${subs}）も消えます。` : ""}貼った画像はメディアに残ります。`))) return;
              await deleteNote(note.id);
              router.push(`/r/${roomId}`);
            }}
          >
            削除
          </MenuItem>
          <MenuDivider />
          <div className="px-2 pt-0.5 pb-1 text-xs leading-relaxed text-muted" data-name="ノートの情報">
            <div>文字数：{countChars(body.blocks).toLocaleString()}</div>
            <div>
              最終更新：{when(body.updatedAt)}
              {editor ? `（${editor}）` : ""}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

/** ロックしているときに上のバーに出す印。押すとロックを外す */
export function LockedChip({ note }: { note: Note }) {
  return (
    <button
      type="button"
      onClick={() => void setNoteLocked(note.id, false)}
      title="押すとロックを外す"
      className="flex h-10 shrink-0 items-center gap-1 rounded-[8px] px-2 text-xs text-muted hover:bg-tint hover:text-ink md:h-7"
    >
      <Icon name="lock" size={14} />
      ロック中
    </button>
  );
}
