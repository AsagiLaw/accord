"use client";

import { Icon } from "@/components/Icon";
import { useMyBoxes } from "@/lib/local/boxes";
import type { RoomMediaChoice } from "@/lib/local/rooms";

/** ルームを作るときに選ぶメディアの設定（入力中の値。決めるときに RoomMediaChoice にする） */
export type RoomMediaDraft = { kind: "new" | "box" | "none"; newName: string; boxId: string; canEdit: boolean };

export const newMediaDraft = (roomName: string): RoomMediaDraft => ({ kind: "new", newName: roomName ? `${roomName}のメディア` : "", boxId: "", canEdit: true });

export function toMediaChoice(d: RoomMediaDraft, roomName: string): RoomMediaChoice {
  if (d.kind === "none") return { kind: "none" };
  if (d.kind === "box" && d.boxId) return { kind: "box", boxId: d.boxId, canEdit: d.canEdit };
  return { kind: "new", name: d.newName.trim() || `${roomName}のメディア`, canEdit: d.canEdit };
}

function Option({ checked, onSelect, title, note, children }: { checked: boolean; onSelect: () => void; title: string; note: string; children?: React.ReactNode }) {
  return (
    <label className={`block cursor-pointer rounded-[12px] border px-3 py-2.5 transition ${checked ? "border-accent bg-tint" : "border-line hover:bg-tint"}`}>
      <span className="flex items-start gap-2">
        <input type="radio" name="room-media" checked={checked} onChange={onSelect} className="mt-1.5 accent-[var(--accent)]" />
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          <span className="block text-xs text-muted">{note}</span>
          {checked && children && <span className="mt-2 block">{children}</span>}
        </span>
      </span>
    </label>
  );
}

/**
 * ルームを作るときの「メディア」：新しいボックスを作る・自分のボックスを使う・設定しない、と、メンバーの権限。
 * あとからルームの設定で変えられる（変えられるのはルームを作ったホストだけ）
 */
export function RoomMediaFields({ userId, value, onChange }: { userId: string; value: RoomMediaDraft; onChange: (v: RoomMediaDraft) => void }) {
  const boxes = useMyBoxes(userId);
  const own = boxes?.own ?? [];
  const set = (patch: Partial<RoomMediaDraft>) => onChange({ ...value, ...patch });
  return (
    <div data-name="ルームのメディアの設定" className="space-y-2">
      <Option checked={value.kind === "new"} onSelect={() => set({ kind: "new" })} title="新しいボックスを作る" note="このルーム用のボックスを作って紐づけます。メンバーで画像を共有できます。">
        <input
          value={value.newName}
          onChange={(e) => set({ newName: e.target.value })}
          maxLength={60}
          aria-label="新しいボックスの名前"
          placeholder="ボックスの名前"
          className="field py-1.5"
        />
      </Option>
      <Option
        checked={value.kind === "box"}
        onSelect={() => set({ kind: "box", boxId: value.boxId || own[0]?.id || "" })}
        title="自分のボックスを使う"
        note={own.length ? "作ってあるボックスを紐づけます。ほかのルームと同じボックスも使えます。" : "まだ自分のボックスがありません（DMの「メディア」で作れます）。"}
      >
        {own.length > 0 && (
          <select value={value.boxId} onChange={(e) => set({ boxId: e.target.value })} aria-label="紐づけるボックス" className="field py-1.5">
            {own.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </Option>
      <Option
        checked={value.kind === "none"}
        onSelect={() => set({ kind: "none" })}
        title="設定しない"
        note="チャットなどで送った画像は、送った人のマイメディアに入ります。ルームの「メディア」には、チャットで送られた画像が並びます。"
      />
      {value.kind !== "none" && (
        <label className="flex items-center gap-2 px-1 pt-1 text-sm">
          <span className="text-muted">メンバーは</span>
          <select value={value.canEdit ? "edit" : "view"} onChange={(e) => set({ canEdit: e.target.value === "edit" })} aria-label="メンバーの権限" className="field w-auto py-1">
            <option value="edit">編集もできる</option>
            <option value="view">見るだけ</option>
          </select>
        </label>
      )}
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
        <Icon name="gear" size={12} className="shrink-0" />
        あとからルームの設定で変えられます（ルームを作ったホストだけ）。
      </p>
    </div>
  );
}
