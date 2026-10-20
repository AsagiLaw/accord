import { DatabaseSkeleton } from "@/components/Skeleton";

/** データベースを開いたとき：押したらすぐ移動して、読み終わるまでは名前・タブ・表の形だけの枠を出す */
export default function Loading() {
  return <DatabaseSkeleton />;
}
