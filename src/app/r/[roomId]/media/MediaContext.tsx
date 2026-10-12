"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Library, Media, Profile } from "@/lib/local/db";
import { useLibraries, useMedia } from "@/lib/local/media";
import type { MemberWithProfile } from "@/lib/local/rooms";

export type MediaState = {
  roomId: string;
  me: Profile;
  members: MemberWithProfile[];
  media: Media[];
  libs: Library[];
  byId: Map<string, Media>;
  /** 選択中の画像（選んだ順） */
  selected: string[];
  setSelected: (ids: string[]) => void;
  /** 大きく表示している画像と、前後に移動できる並び */
  viewing: { id: string; list: string[] } | null;
  setViewing: (id: string | null, list?: string[]) => void;
  /** 整理ダイアログで扱う画像 */
  organizing: string[] | null;
  setOrganizing: (ids: string[] | null) => void;
  /** 「画像を追加」ダイアログを開いているライブラリー */
  addingTo: string | null;
  setAddingTo: (libId: string | null) => void;
  /** 名前をその場で書き換えている画像（右クリックの「名前を変更」） */
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  /** 編集している画像 */
  editing: string | null;
  setEditing: (id: string | null) => void;
};

const Ctx = createContext<MediaState | null>(null);

export function useMediaState() {
  const v = useContext(Ctx);
  if (!v) throw new Error("MediaProvider がありません");
  return v;
}

export function MediaProvider({
  roomId,
  me,
  members,
  children,
}: {
  roomId: string;
  me: Profile;
  members: MemberWithProfile[];
  children: React.ReactNode;
}) {
  const media = useMedia(roomId);
  const libs = useLibraries(roomId);
  const [selected, setSelected] = useState<string[]>([]);
  const [viewing, setViewingState] = useState<{
    id: string;
    list: string[];
  } | null>(null);
  const [organizing, setOrganizing] = useState<string[] | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const value = useMemo<MediaState | null>(() => {
    if (!media || !libs) return null;
    return {
      roomId,
      me,
      members,
      media,
      libs,
      byId: new Map(media.map((m) => [m.id, m])),
      selected: selected.filter((id) => media.some((m) => m.id === id)),
      setSelected,
      viewing:
        viewing && media.some((m) => m.id === viewing.id) ? viewing : null,
      setViewing: (id, list) =>
        setViewingState(id ? { id, list: list ?? [id] } : null),
      organizing,
      setOrganizing,
      addingTo:
        addingTo && libs.some((l) => l.id === addingTo) ? addingTo : null,
      setAddingTo,
      renaming,
      setRenaming,
      editing: editing && media.some((m) => m.id === editing) ? editing : null,
      setEditing,
    };
  }, [
    roomId,
    me,
    members,
    media,
    libs,
    selected,
    viewing,
    organizing,
    addingTo,
    renaming,
    editing,
  ]);

  if (!value) return <p className="p-8 text-muted">読み込み中…</p>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
