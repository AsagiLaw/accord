"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DatabaseView } from "@/components/db/DatabaseView";
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
  );
}
