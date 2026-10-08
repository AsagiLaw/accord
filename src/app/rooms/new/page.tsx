"use client";

import { CreateRoomForm } from "@/components/CreateRoomForm";
import { useCurrentUser } from "@/lib/local/session";

export default function NewRoomPage() {
  const me = useCurrentUser();
  if (!me) return <p className="p-8 text-muted">読み込み中…</p>;
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-2 text-2xl font-bold">ルームを作る</h1>
      <p className="mb-6 text-sm text-muted">作った人（{me.displayName}）がホストになります。</p>
      <CreateRoomForm userId={me.id} />
    </main>
  );
}
