"use client";

import { useParams } from "next/navigation";
import { WindowView } from "@/components/window/WindowView";

export default function WindowScreen() {
  const { roomId, windowId } = useParams<{ roomId: string; windowId: string }>();
  return <WindowView roomId={roomId} windowId={windowId} />;
}
