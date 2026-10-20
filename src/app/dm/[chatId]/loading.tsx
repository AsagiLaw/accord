import { ChatSkeleton } from "@/components/Skeleton";

/** チャットを開いたとき：押したらすぐ移動して、読み終わるまでは発言の形だけの枠を出す */
export default function Loading() {
  return <ChatSkeleton />;
}
