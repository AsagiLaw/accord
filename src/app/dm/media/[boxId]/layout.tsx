"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { MediaScreen } from "@/components/media/MediaScreen";
import { useBox, useBoxAccess, useBoxMembers } from "@/lib/local/boxes";
import { useCurrentUser } from "@/lib/local/session";

/** DM の「メディア」から開いた、1つのボックスのメディア画面。持ち主か、共有された人だけが開ける */
export default function BoxLayout({ children }: { children: React.ReactNode }) {
  const { boxId } = useParams<{ boxId: string }>();
  const me = useCurrentUser();
  const box = useBox(boxId);
  const access = useBoxAccess(boxId, me?.id);
  const members = useBoxMembers(boxId);
  if (!me || box === undefined || access === undefined || !members) return <p className="text-muted">読み込み中…</p>;
  if (!box || !access) {
    return (
      <p className="text-muted">
        このボックスは見られません。<Link href="/dm/media" className="underline">ボックスの一覧へ</Link>
      </p>
    );
  }
  return (
    <MediaScreen boxId={box.id} base={`/dm/media/${box.id}`} title={box.name} canEdit={access !== "view"} me={me} members={members}>
      {children}
    </MediaScreen>
  );
}
