"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { newMediaDraft, RoomMediaFields, toMediaChoice } from "@/components/RoomMediaFields";
import { createRoom } from "@/lib/local/rooms";

export function CreateRoomForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [media, setMedia] = useState(() => newMediaDraft(""));
  // ボックスの名前は、自分で書き換えるまではルーム名に合わせる
  const [nameTouched, setNameTouched] = useState(false);
  return (
    <form
      className="card space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        router.push(`/r/${await createRoom(name.trim(), userId, undefined, undefined, toMediaChoice(media, name.trim()))}`);
      }}
    >
      <label className="block">
        <span className="text-sm text-muted">ルーム名</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!nameTouched) setMedia({ ...media, newName: e.target.value.trim() ? `${e.target.value.trim()}のメディア` : "" });
          }}
          required
          maxLength={60}
          className="field"
        />
      </label>
      <div>
        <span className="mb-1 block text-sm text-muted">メディア</span>
        <RoomMediaFields
          userId={userId}
          value={media}
          onChange={(v) => {
            if (v.newName !== media.newName) setNameTouched(true);
            setMedia(v);
          }}
        />
      </div>
      <button className="btn w-full">ルームを作る</button>
    </form>
  );
}
