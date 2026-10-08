"use client";

import { useParams } from "next/navigation";
import { MediaView } from "../../MediaView";

export default function LibraryPage() {
  const { libId } = useParams<{ libId: string }>();
  return <MediaView view={{ kind: "lib", id: libId }} />;
}
