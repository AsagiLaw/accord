"use client";

import { Spinner } from "@/components/ui/Spinner";
import { useBlobState } from "@/lib/media/blob-url";

/** メディアの一覧用の小さい画像 */
export function ThumbImage({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const { url, loading } = useBlobState(id, "thumb");
  // 収め方（object-contain など）を渡されたら、はじめの object-cover は付けない（両方あると object-cover が勝ってしまう）
  const fit = className?.includes("object-") ? "" : "object-cover";
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- ブラウザ内の Blob なので next/image は使えない
    <img src={url} alt={alt} draggable={false} className={`h-full w-full ${fit} ${className ?? ""}`} />
  ) : (
    // 取りに行っている途中なら、くるくるを出す（アイコンほどの小さな四角では出さない）
    <span className="@container relative block h-full w-full bg-line/50">{loading && <Spinner className="@max-[40px]:hidden" />}</span>
  );
}
