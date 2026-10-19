"use client";

import { Icon } from "@/components/Icon";
import { Select } from "@/components/ui/Select";
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
    <label title={note} className={`block cursor-pointer rounded-[12px] border px-3 py-2.5 transition ${checked ? "border-accent bg-tint" : "border-line hover:bg-tint"}`}>
      <span className="flex items-start gap-2">
        {/* 丸の印は自分で描く（ブラウザのラジオボタンは見えないようにして、読み上げとキーボードのためだけに残す） */}
        <input type="radio" name="room-media" checked={checked} onChange={onSelect} className="peer sr-only" />
        <span aria-hidden className={`mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${checked ? "border-accent" : "border-muted"}`}>
          {checked && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
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
          <Select value={value.boxId} onChange={(boxId) => set({ boxId })} label="紐づけるボックス" size="lg" options={own.map((b) => ({ value: b.id, label: b.name }))} />
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
          <Select
            value={value.canEdit ? "edit" : "view"}
            onChange={(v) => set({ canEdit: v === "edit" })}
            label="メンバーの権限"
            className="w-36"
            options={[
              { value: "edit", label: "編集もできる" },
              { value: "view", label: "見るだけ" },
            ]}
          />
        </label>
      )}
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
        <Icon name="gear" size={12} className="shrink-0" />
        あとからルームの設定で変えられます（ルームを作ったホストだけ）。
      </p>
    </div>
  );
}
