"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { BoxShareDialog } from "@/components/media/BoxShareDialog";
import { CoverCard } from "@/components/media/LibraryCard";
import { MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import { confirmAction, promptText } from "@/components/ui/overlay";
import { createBox, deleteBox, renameBox, useMyBoxes, type MyBoxes } from "@/lib/local/boxes";
import type { Media, MediaBox, Profile } from "@/lib/local/db";
import { useBoxSummaries } from "@/lib/local/media";
import { useCurrentUser } from "@/lib/local/session";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2";

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section>
      {/* 説明はいつもは出さず、見出しにカーソルを乗せてしばらくすると出す */}
      <h2 className="mb-2 w-fit font-bold" title={note}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** カードと同じ大きさの、点線の「作る」カード */
function AddCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block w-full rounded-[12px] p-1.5 text-left transition hover:bg-tint">
      <span className="grid aspect-[3/2] place-items-center rounded-[10px] border-2 border-dashed border-line text-muted">
        <Icon name="add" size={28} />
      </span>
      <span className="mt-1 block truncate text-sm text-muted">{label}</span>
    </button>
  );
}

type Summary = Map<string, { count: number; covers: Media[] }>;

/** ボックスのカード。下に共有先を小さく出す。自分で作ったボックスは、右クリックか「…」で名前の変更・削除 */
function BoxCard({ box, data, summary, note, me, editable }: { box: MediaBox; data: MyBoxes; summary: Summary | undefined; note: string; me: Profile; editable?: boolean }) {
  const menu = usePopover();
  const [sharing, setSharing] = useState(false);
  const s = summary?.get(box.id);
  const shares = data.shares.get(box.id) ?? [];
  // 自分のボックスは共有先を、共有されたボックスは「見るだけ」かどうかを出す
  const viewOnly = data.access.get(box.id) === "view";
  // マイメディアは共有できないので、渡された説明（自分専用）を出す
  const shareNote = editable || box.kind === "mine"
    ? shares.length
      ? shares.map((x) => `${x.label}${x.canEdit ? "" : "（見るだけ）"}`).join("・")
      : note
    : [
        `${data.owners.get(box.id) ?? ""}さんのボックス`,
        // 自分に共有されたものは書かない（ルームから使えるときは、そのルームを出す）
        ...shares.filter((x) => x.roomId).map((x) => x.label),
        ...(viewOnly ? ["見るだけ"] : []),
      ].join("・");
  return (
    <div onContextMenu={editable ? menu.openAt : undefined}>
      <CoverCard href={`/dm/media/${box.id}`} name={box.name} covers={s?.covers ?? []} count={s?.count ?? 0}>
        {editable && (
          <button
            type="button"
            aria-label={`「${box.name}」のメニュー`}
            title="メニュー"
            aria-haspopup="menu"
            aria-expanded={!!menu.anchor}
            onClick={menu.toggle}
            className="absolute right-1 bottom-0.5 grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink"
          >
            <Icon name="dots" size={18} />
          </button>
        )}
      </CoverCard>
      <p className="truncate px-1.5 text-xs text-muted" title={shareNote}>
        {shareNote}
      </p>
      {editable && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={220} label="ボックスのメニュー">
          <MenuItem
            icon={<Icon name="ppl" size={16} />}
            onClick={() => {
              menu.close();
              setSharing(true);
            }}
          >
            共有と紐づけ
          </MenuItem>
          <MenuItem
            icon={<Icon name="edit" size={16} />}
            onClick={async () => {
              menu.close();
              const name = await promptText("ボックスの名前", box.name);
              if (name?.trim()) await renameBox(box.id, name.trim());
            }}
          >
            名前を変更
          </MenuItem>
          <MenuItem
            icon={<Icon name="del" size={16} />}
            danger
            onClick={async () => {
              menu.close();
              const ok = await confirmAction(
                `「${box.name}」を削除します`,
                "削除",
                "中の画像は消えず、それぞれ入れた人のマイメディアに移ります（ライブラリーからは外れます）。共有や紐づけも外れます。",
              );
              if (ok) await deleteBox(box.id);
            }}
          >
            削除
          </MenuItem>
        </Popover>
      )}
      {sharing && <BoxShareDialog box={box} me={me} onClose={() => setSharing(false)} />}
    </div>
  );
}

/**
 * メディアのボックスの一覧：マイメディア（自分専用・削除できない）、自分で作ったボックス、共有されたボックス。
 * カードを押すと、そのボックスのメディア画面を開く
 */
export default function DmMediaPage() {
  const router = useRouter();
  const me = useCurrentUser();
  const data = useMyBoxes(me?.id);
  const all = data ? [...(data.mine ? [data.mine] : []), ...data.own, ...data.shared] : [];
  const summary = useBoxSummaries(all.map((b) => b.id));

  if (!me || !data) return <p className="loading text-muted">読み込み中…</p>;

  const create = async () => {
    const name = await promptText("新しいボックスの名前", "", "例：資料・納品用");
    if (!name?.trim()) return;
    const box = await createBox(me.id, name.trim());
    router.push(`/dm/media/${box.id}`);
  };

  return (
    <div data-name="メディアボックス一覧" className="mx-auto max-w-5xl space-y-6">
      <Section title="マイメディア" note="自分専用のボックスです。削除や共有はできません。DMで送った画像もここに入ります。">
        <div className={GRID}>{data.mine && <BoxCard box={data.mine} data={data} summary={summary} note="自分専用" me={me} />}</div>
      </Section>

      <Section title="自分のボックス" note="自分で作るボックスです。フレンドと共有したり、ルームに紐づけたりできます。">
        <div className={GRID}>
          {data.own.map((b) => (
            <BoxCard key={b.id} box={b} data={data} summary={summary} note="共有なし" me={me} editable />
          ))}
          <AddCard label="ボックスを作る" onClick={create} />
        </div>
      </Section>

      <Section title="共有されたボックス" note="フレンドや、参加しているルームから共有されたボックスです。">
        {data.shared.length ? (
          <div className={GRID}>
            {data.shared.map((b) => (
              <BoxCard key={b.id} box={b} data={data} summary={summary} note="" me={me} />
            ))}
          </div>
        ) : (
          <p className="rounded-[10px] border border-dashed border-line px-3 py-4 text-center text-sm text-muted">まだありません</p>
        )}
      </Section>
    </div>
  );
}
