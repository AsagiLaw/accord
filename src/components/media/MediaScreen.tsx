"use client";

import { notFound, useParams, usePathname } from "next/navigation";
import type { Profile } from "@/lib/local/db";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { AddToLibraryDialog } from "./AddToLibraryDialog";
import { ImageEditor } from "./ImageEditor";
import { Lightbox } from "./Lightbox";
import { MediaProvider, useMediaState } from "./MediaContext";
import { MediaView, type MediaViewKind } from "./MediaView";
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
      <CurrentView base={base} />
      {children}
      <Overlays />
    </MediaProvider>
  );
}

const VIEWS = { unsorted: "unsorted", all: "all", favorites: "fav", trash: "trash" } as const;

/** URL の土台より後ろ（"" ・"/all"・"/lib/（ライブラリー）" など）から、開く場所を決める。違う形なら null */
function viewOf(rest: string): MediaViewKind | null {
  if (rest === "" || rest === "/") return { kind: "home" };
  const lib = rest.match(/^\/lib\/([^/]+)\/?$/);
  if (lib) return { kind: "lib", id: decodeURIComponent(lib[1]) };
  const name = rest.replace(/^\/|\/$/g, "");
  return Object.hasOwn(VIEWS, name) ? { kind: VIEWS[name as keyof typeof VIEWS] } : null;
}

/**
 * 今の URL の場所を出す。同じメディア画面の中の移動は URL だけを変える（MediaLink）ので、
 * ページではなくここで URL から描く。場所ごとに作り直す（選択や検索は場所ごと）
 */
function CurrentView({ base }: { base: string }) {
  const pathname = usePathname();
  const view = pathname.startsWith(base) ? viewOf(pathname.slice(base.length)) : null;
  if (!view) return null;
  return <MediaView key={view.kind === "lib" ? `lib:${view.id}` : view.kind} view={view} />;
}

// ---- ページ（ルームと DM のルートから、そのまま使う）。中身は CurrentView が出すので、ここでは何も出さない ----

export function MediaHomePage() {
  return null;
}

export function MediaListPage() {
  const { view } = useParams<{ view: string }>();
  // 無い一覧の URL を直接開いたときは「見つかりません」
  if (!Object.hasOwn(VIEWS, view)) notFound();
  return null;
}

export function LibraryPage() {
  return null;
}
