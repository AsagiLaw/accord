import { DocSkeleton } from "@/components/Skeleton";

/** ブロックを並べた画面を開いたとき：押したらすぐ移動して、読み終わるまでは見出しと文章の形だけの枠を出す */
export default function Loading() {
  return <DocSkeleton />;
}
