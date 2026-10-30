"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DatabaseView } from "@/components/db/DatabaseView";
import { confirmAction } from "@/components/ui/overlay";
import { deleteDatabase } from "@/lib/local/channels";
import type { Database } from "@/lib/local/db";
import { restoreInlineDb } from "@/lib/local/inlineDbs";
import { useDatabase, useEvents, usePages, useViews } from "@/lib/local/requests";
import { useMembers } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { DatabaseSkeleton } from "@/components/Skeleton";

export default function DatabasePage() {
  const { roomId, dbId } = useParams<{ roomId: string; dbId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const database = useDatabase(dbId);
  const pages = usePages(dbId);
  const views = useViews(dbId);
  const events = useEvents(roomId);
  const members = useMembers(roomId);
  const me = useCurrentUser();
  // サイドバーの＋から来たとき（?new=1）は、追加のフォームを開く
  const wantsNew = search.get("new");
  const [handledNew, setHandledNew] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  if (wantsNew !== handledNew) {
    setHandledNew(wantsNew);
    if (wantsNew) setOpenNew(true);
  }

  if (database === undefined || !pages || !views || !events || !members || !me) return <DatabaseSkeleton type={(views?.find((v) => v.id === search.get("v")) ?? views?.[0])?.type} />;
  if (!database || database.roomId !== roomId) {
    return (
      <p className="text-muted">
        見つかりません。
        <Link href={`/r/${roomId}`} className="underline">
          ルームの最初へ
        </Link>
      </p>
    );
  }
  const view = views.find((v) => v.id === search.get("v")) ?? views[0];

  return (
    <>
      {database.deletedAt && <TrashBar database={database} userId={me.id} />}
      <DatabaseView
        database={database}
        views={views}
        view={view}
        pages={pages}
        events={events}
        members={members}
        userId={me.id}
        openNew={openNew}
        onCloseNew={() => {
          setOpenNew(false);
          if (wantsNew) router.replace(`?v=${view?.id ?? ""}`);
        }}
      />
    </>
  );
}

/** ゴミ箱にあるノートの中のデータベースの上の帯（ノートのゴミ箱の帯と同じ）：元に戻す・完全に削除 */
function TrashBar({ database, userId }: { database: Database; userId: string }) {
  const router = useRouter();
  const name = database.name || "無題";
  return (
    <div role="alert" data-name="ゴミ箱のデータベース" className="note-trash-bar mb-3">
      <span>このデータベースはゴミ箱にあります</span>
      <button type="button" onClick={() => void restoreInlineDb(database, userId)}>
        元に戻す
      </button>
      <button
        type="button"
        onClick={async () => {
          if (!(await confirmAction(`「${name}」を完全に削除します`, "削除", "中のページと、チャットの発言も消えます。元に戻せません。"))) return;
          router.push(database.noteId ? `/r/${database.roomId}/note/${database.noteId}` : `/r/${database.roomId}`);
          await deleteDatabase(database.id);
        }}
      >
        完全に削除
      </button>
    </div>
  );
}
