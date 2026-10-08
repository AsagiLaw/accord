"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createRoom } from "@/lib/local/rooms";

export function CreateRoomForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  return (
    <form
      className="card space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        router.push(`/r/${await createRoom(name.trim(), userId)}`);
      }}
    >
      <label className="block">
        <span className="text-sm text-muted">ルーム名</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} className="field" />
      </label>
      <button className="btn w-full">ルームを作る</button>
    </form>
  );
}
