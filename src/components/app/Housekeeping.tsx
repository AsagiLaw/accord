"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useChatNotifications } from "@/lib/local/chatNotify";
import { useDueNotifications } from "@/lib/local/dueNotify";
import { purgeOldTrash } from "@/lib/local/requests";
import { useCurrentUser } from "@/lib/local/session";
import { onNotificationOpen, registerAppWorker } from "@/lib/notify";

/**
 * 画面に出ない、アプリ全体の決まった仕事（ログインしているときだけ）：
 * ゴミ箱に入れて30日たったページを完全に削除する（開いたときに1回）・納期とチャットのブラウザの通知を見る
 */
export function Housekeeping() {
  const me = useCurrentUser();
  const router = useRouter();
  const signedIn = !!me;
  useEffect(() => {
    if (signedIn) void purgeOldTrash();
  }, [signedIn]);
  // 通知はサービスワーカーから出す。通知を押したら、その画面をアプリの中の移動で開く
  useEffect(() => {
    if (!signedIn) return;
    registerAppWorker();
    return onNotificationOpen((href) => router.push(href));
  }, [signedIn, router]);
  useDueNotifications(me);
  useChatNotifications(me?.id);
  return null;
}
