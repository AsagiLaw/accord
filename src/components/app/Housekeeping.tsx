"use client";

import { useEffect } from "react";
import { useDueNotifications } from "@/lib/local/dueNotify";
import { purgeOldTrash } from "@/lib/local/requests";
import { useCurrentUser } from "@/lib/local/session";

/**
 * 画面に出ない、アプリ全体の決まった仕事（ログインしているときだけ）：
 * ゴミ箱に入れて30日たったページを完全に削除する（開いたときに1回）・納期のブラウザの通知を見る
 */
export function Housekeeping() {
  const me = useCurrentUser();
  const signedIn = !!me;
  useEffect(() => {
    if (signedIn) void purgeOldTrash();
  }, [signedIn]);
  useDueNotifications(me);
  return null;
}
