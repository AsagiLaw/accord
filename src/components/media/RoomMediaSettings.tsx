"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { confirmAction, toast } from "@/components/ui/overlay";
import { countImagesMovedIfRemoved, linkBoxToRoom, removeShare, setShareCanEdit, useMyBoxes, useRoomBox } from "@/lib/local/boxes";
import type { Profile, Room } from "@/lib/local/db";
import { useBoxContributors } from "@/lib/local/media";
import { useAllProfiles } from "@/lib/local/rooms";

/**
 * ルームの設定の「メディア」：紐づいているボックス（持ち主・メンバーの権限）と、だれが何枚入れているか。
 * ボックスの付け替え・権限の変更・紐づけを外すのは、ルームを作ったホストだけ
 */
export function RoomMediaSettings({ roomId, room, me }: { roomId: string; room: Room; me: Profile }) {
  const link = useRoomBox(roomId);
  const contributors = useBoxContributors(link?.box.id);
  const profiles = useAllProfiles();
  const myBoxes = useMyBoxes(me.id);
  const [busy, setBusy] = useState(false);
  const isHost = room.createdBy === me.id;
  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.displayName ?? "削除された人";

  if (link === undefined || !contributors || !profiles) return null;

  /** 今の紐づけを外す。外すとメンバーが入れた画像が移るときは、先に確かめる */
  const unlink = async (verb: string) => {
    if (!link) return true;
    const n = await countImagesMovedIfRemoved(link.share.id);
    const body = n > 0 ? `メンバーが入れた画像${n}枚は、ボックスから外れて、それぞれのマイメディアに移ります。` : "ボックスと画像は消えません。";
    if (!(await confirmAction(`「${link.box.name}」の紐づけを外して${verb}`, verb === "" ? "外す" : "続ける", body))) return false;
    await removeShare(link.share.id);
    return true;
  };

  const changeBox = async (boxId: string) => {
    if (!isHost || boxId === link?.box.id) return;
    setBusy(true);
    try {
      if (!(await unlink("、別のボックスにします"))) return;
      if (boxId) {
        const r = await linkBoxToRoom(boxId, roomId, link?.share.canEdit ?? true, me.id);
        toast(r === "ok" ? "ボックスを変えました" : "紐づけられませんでした");
      } else {
        toast("紐づけを外しました");
      }
    } finally {
      setBusy(false);
    }
  };

  // ホストが選べるボックス：自分で作ったボックス（今紐づいているものも含む）
  const choices = [...(myBoxes?.own ?? [])];
  if (link && !choices.some((b) => b.id === link.box.id)) choices.unshift(link.box);

  return (
    <section data-name="ルームのメディア" className="card space-y-3">
      <div>
        <h2 className="mb-1 font-bold">メディア</h2>
        <p className="text-sm text-muted">
          このルームに紐づいているメディアのボックスです。変えられるのは、ルームを作ったホスト（{nameOf(room.createdBy)}）だけです。
        </p>
      </div>

      {link ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">ボックス</dt>
          <dd className="flex min-w-0 items-center gap-1.5 font-bold">
            <Icon name="folder" size={16} className="shrink-0 text-muted" />
            <Link href={`/r/${roomId}/media`} className="truncate hover:underline">
              {link.box.name}
            </Link>
          </dd>
          <dt className="text-muted">共有している人</dt>
          <dd>{nameOf(link.box.ownerId)}（ボックスの持ち主）</dd>
          <dt className="text-muted">メンバーは</dt>
          <dd>{link.share.canEdit ? "編集もできる" : "見るだけ"}</dd>
          <dt className="text-muted">入れた人</dt>
          <dd>
            {contributors.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {contributors.map((c) => (
                  <li key={c.userId} className="rounded-full bg-tint px-2.5 py-0.5">
                    {c.name} {c.count}枚
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted">まだ画像はありません</span>
            )}
          </dd>
        </dl>
      ) : (
        <p className="rounded-[10px] border border-dashed border-line px-3 py-3 text-sm text-muted">
          ボックスが紐づいていません。チャットで送った画像は、送った人のマイメディアに入ります。
        </p>
      )}

      {isHost ? (
        <div data-name="メディアの変更（ホストのみ）" className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
          <label className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-muted">ボックス</span>
            <select value={link?.box.id ?? ""} disabled={busy} onChange={(e) => changeBox(e.target.value)} className="field w-auto min-w-0 py-1" aria-label="紐づけるボックス">
              <option value="">紐づけない</option>
              {choices.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.ownerId !== me.id ? `（${nameOf(b.ownerId)}）` : ""}
                </option>
              ))}
            </select>
          </label>
          {link && (
            <label className="flex items-center gap-2">
              <span className="shrink-0 text-muted">メンバーは</span>
              <select
                value={link.share.canEdit ? "edit" : "view"}
                disabled={busy}
                onChange={(e) => setShareCanEdit(link.share.id, e.target.value === "edit")}
                className="field w-auto py-1"
                aria-label="メンバーの権限"
              >
                <option value="edit">編集もできる</option>
                <option value="view">見るだけ</option>
              </select>
            </label>
          )}
          {!myBoxes?.own.length && !link && <span className="text-xs text-muted">DMの「メディア」でボックスを作ると、ここで選べます。</span>}
        </div>
      ) : (
        <p className="border-t border-line pt-3 text-xs text-muted">メディアを変えられるのは、ルームを作ったホストだけです。</p>
      )}
    </section>
  );
}
