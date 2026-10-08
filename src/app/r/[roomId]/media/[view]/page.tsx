"use client";

import { notFound, useParams } from "next/navigation";
import { MediaView } from "../MediaView";

const VIEWS = { unsorted: "unsorted", all: "all", favorites: "fav", trash: "trash" } as const;

export default function MediaListPage() {
  const { view } = useParams<{ view: string }>();
  const kind = VIEWS[view as keyof typeof VIEWS];
  if (!kind) notFound();
  return <MediaView view={{ kind }} />;
}
