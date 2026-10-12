"use client";

import { useParams } from "next/navigation";
import { useMembers } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { AddToLibraryDialog } from "./AddToLibraryDialog";
import { ImageEditor } from "./ImageEditor";
import { Lightbox } from "./Lightbox";
import { MediaProvider, useMediaState } from "./MediaContext";
import { OrganizeDialog } from "./OrganizeDialog";

function Overlays() {
  const { viewing, organizing, addingTo, editing } = useMediaState();
  return (
    <>
      {viewing && <Lightbox />}
      {organizing && (
        <OrganizeDialog key={organizing.join()} ids={organizing} />
      )}
      {addingTo && <AddToLibraryDialog key={addingTo} libId={addingTo} />}
      {editing && <ImageEditor key={editing} id={editing} />}
    </>
  );
}

export default function MediaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { roomId } = useParams<{ roomId: string }>();
  const me = useCurrentUser();
  const members = useMembers(roomId);
  if (!me || !members) return null;
  return (
    <MediaProvider roomId={roomId} me={me} members={members}>
      {children}
      <Overlays />
    </MediaProvider>
  );
}
