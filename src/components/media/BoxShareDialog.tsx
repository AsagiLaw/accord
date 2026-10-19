"use client";

import { Icon } from "@/components/Icon";
import { PopupDialog } from "@/components/ui/Dialog";
import { confirmAction, toast } from "@/components/ui/overlay";
import { Select } from "@/components/ui/Select";
import {
  countImagesMovedIfRemoved,
  linkBoxToRoom,
  removeShare,
  setShareCanEdit,
  shareBoxWithFriend,
  useBoxShares,
  useRoomLinks,
} from "@/lib/local/boxes";
import type { BoxShare, MediaBox, Profile } from "@/lib/local/db";
import { useFriendships } from "@/lib/local/friends";
import { useMyRooms } from "@/lib/local/rooms";

type Level = "none" | "view" | "edit";
const levelOf = (s: BoxShare | undefined): Level => (!s ? "none" : s.canEdit ? "edit" : "view");

/** 共有の段階を選ぶ。none のときの文字は、フレンドは「共有しない」、ルームは「紐づけない」 */
function LevelSelect({ value, noneLabel, label, onChange }: { value: Level; noneLabel: string; label: string; onChange: (v: Level) => void }) {
  return (
    <Select
      value={value}
      onChange={onChange}
      label={label}
      className="w-36 shrink-0"
      options={[
        { value: "none", label: noneLabel },
        { value: "view", label: "見るだけ" },
        { value: "edit", label: "編集もできる" },
      ]}
    />
  );
}

function Row({ icon, name, note, children }: { icon: React.ReactNode; name: string; note?: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 border-t border-line px-1 py-2 first:border-t-0">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-tint text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{name}</span>
        {note && <span className="block truncate text-xs text-muted">{note}</span>}
      </span>
      {children}
    </li>
  );
}

/**
 * ボックスの共有の設定（持ち主だけが開く）。フレンドごと・ルームごとに「共有しない／見るだけ／編集もできる」を選ぶ。
 * 1つのルームに紐づけられるボックスは1つだけ。共有をやめると、使えなくなった人が入れた画像は、その人のマイメディアに移る
 */
export function BoxShareDialog({ box, me, onClose }: { box: MediaBox; me: Profile; onClose: () => void }) {
  const shares = useBoxShares(box.id);
  const friendships = useFriendships(me.id);
  const rooms = useMyRooms(me.id);
  const links = useRoomLinks((rooms ?? []).map((r) => r.id));

  const change = async (share: BoxShare | undefined, next: Level, who: string, add: (canEdit: boolean) => Promise<unknown>) => {
    if (next === levelOf(share)) return;
    if (next === "none") {
      if (!share) return;
      const n = await countImagesMovedIfRemoved(share.id);
      if (n > 0 && !(await confirmAction(`${who}との共有をやめます`, "共有をやめる", `使えなくなる人が入れた画像${n}枚は、ボックスから外れて、それぞれのマイメディアに移ります。`))) return;
      const moved = await removeShare(share.id);
      toast(moved ? `共有をやめました（${moved}枚をそれぞれのマイメディアに移しました）` : "共有をやめました");
      return;
    }
    if (share) await setShareCanEdit(share.id, next === "edit");
    else await add(next === "edit");
  };

  const loading = !shares || !friendships || !rooms || !links;
  return (
    <PopupDialog
      title={`「${box.name}」の共有`}
      note="1つのルームに紐づけられるボックスは1つだけです。共有をやめると、使えなくなった人が入れた画像は、その人のマイメディアに移ります"
      onClose={onClose}
      width="max-w-lg"
    >
      {loading ? (
        <p className="loading text-muted">読み込み中…</p>
      ) : (
        <div data-name="ボックスの共有" className="space-y-5">
          <section>
            <h4 className="mb-1 text-xs font-bold tracking-wide text-muted">フレンド</h4>
            {friendships.friends.length ? (
              <ul>
                {friendships.friends.map(({ other }) => {
                  const share = shares.find((s) => s.userId === other.id);
                  return (
                    <Row key={other.id} icon={<Icon name="person" size={16} />} name={other.displayName}>
                      <LevelSelect
                        value={levelOf(share)}
                        noneLabel="共有しない"
                        label={`${other.displayName}さんとの共有`}
                        onChange={(v) => change(share, v, `${other.displayName}さん`, (canEdit) => shareBoxWithFriend(box.id, other.id, canEdit))}
                      />
                    </Row>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">フレンドがいません。DMの「フレンド」から追加できます。</p>
            )}
          </section>

          <section>
            <h4 className="mb-1 text-xs font-bold tracking-wide text-muted">ルーム（メンバー全員で使う）</h4>
            {rooms.length ? (
              <ul>
                {rooms.map((r) => {
                  const share = shares.find((s) => s.roomId === r.id);
                  const other = links.get(r.id);
                  const taken = other && other.id !== box.id;
                  const host = r.createdBy === me.id;
                  return (
                    <Row
                      key={r.id}
                      icon={<Icon name="hash" size={16} />}
                      name={r.name}
                      note={taken ? `「${other.name}」が紐づいています` : !host ? "メディアを変えられるのは、ルームを作ったホストだけです" : undefined}
                    >
                      {taken || !host ? (
                        <span className="shrink-0 text-xs text-muted">{share ? (share.canEdit ? "編集もできる" : "見るだけ") : "紐づけられません"}</span>
                      ) : (
                        <LevelSelect
                          value={levelOf(share)}
                          noneLabel="紐づけない"
                          label={`ルーム「${r.name}」との紐づけ`}
                          onChange={(v) =>
                            change(share, v, `ルーム「${r.name}」`, async (canEdit) => {
                              const res = await linkBoxToRoom(box.id, r.id, canEdit, me.id);
                              if (res === "taken") toast("このルームには、ほかのボックスが紐づいています");
                              if (res === "forbidden") toast("メディアを変えられるのは、ルームを作ったホストだけです");
                            })
                          }
                        />
                      )}
                    </Row>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">参加しているルームがありません。</p>
            )}
          </section>
        </div>
      )}
    </PopupDialog>
  );
}
