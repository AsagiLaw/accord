"use client";

import { notFound, useParams } from "next/navigation";
import type { Profile } from "@/lib/local/db";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { AddToLibraryDialog } from "./AddToLibraryDialog";
import { ImageEditor } from "./ImageEditor";
import { Lightbox } from "./Lightbox";
import { MediaProvider, useMediaState } from "./MediaContext";
import { MediaView } from "./MediaView";
import { OrganizeDialog } from "./OrganizeDialog";

function Overlays() {
  const { viewing, organizing, addingTo, editing } = useMediaState();
  return (
    <>
      {viewing && <Lightbox />}
      {organizing && <OrganizeDialog key={organizing.join()} ids={organizing} />}
      {addingTo && <AddToLibraryDialog key={addingTo} libId={addingTo} />}
      {editing && <ImageEditor key={editing} id={editing} />}
    </>
  );
}

/**
 * 1つのボックスのメディア画面の入れ物（ルームの「メディア」と、DM のボックスで同じものを使う）。
 * 中のページ（ホーム・一覧・ライブラリー）と、拡大表示・整理・編集などのダイアログ
 */
export function MediaScreen({
  boxId,
  base,
  title,
  canEdit,
  me,
  members,
  children,
}: {
  boxId: string;
  base: string;
  title: string;
  /** 見るだけの共有なら false（追加・整理・編集などの操作を出さない） */
  canEdit: boolean;
  me: Profile;
  members: MemberWithProfile[];
  children: React.ReactNode;
}) {
  return (
    <MediaProvider key={boxId} boxId={boxId} base={base} title={title} canEdit={canEdit} me={me} members={members}>
      {children}
      <Overlays />
    </MediaProvider>
  );
}

// ---- ページ（ルームと DM のルートから、そのまま使う） ----

export function MediaHomePage() {
  return <MediaView view={{ kind: "home" }} />;
}

const VIEWS = { unsorted: "unsorted", all: "all", favorites: "fav", trash: "trash" } as const;

export function MediaListPage() {
  const { view } = useParams<{ view: string }>();
  const kind = VIEWS[view as keyof typeof VIEWS];
  if (!kind) notFound();
  return <MediaView view={{ kind }} />;
}

export function LibraryPage() {
  const { libId } = useParams<{ libId: string }>();
  return <MediaView view={{ kind: "lib", id: libId }} />;
}
