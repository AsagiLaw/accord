"use client";

import { useParams } from "next/navigation";
import { PageBody } from "@/components/db/PageBody";

/** データベースのページの画面。中身は PageBody（ビューから開くポップアップと同じ） */
export default function RequestPage() {
  const { roomId, dbId, pageId } = useParams<{ roomId: string; dbId: string; pageId: string }>();
  return <PageBody roomId={roomId} dbId={dbId} pageId={pageId} />;
}
