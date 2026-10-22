"use client";

import { useCallback, useSyncExternalStore } from "react";
import { confirmAction } from "@/components/ui/overlay";
import { deleteMessage } from "@/lib/local/chat";
import type { Message } from "@/lib/local/db";
import { resendRows, sendStateOf, subscribeSendState, type SendState, type Tbl } from "@/lib/local/rowSync";
import { retryUpload, subscribeUploads, uploadStateOf } from "@/lib/media/remote";

// 自分の発言が、ほかの人に届いたか（Discord と同じ）。届くまでは発言を薄く出して「送信中…」、断られたら「送信できませんでした」

type Sent = Pick<Message, "id" | "mediaIds">;

const subscribe = (f: () => void) => {
  const a = subscribeSendState(f);
  const b = subscribeUploads(f);
  return () => {
    a();
    b();
  };
};

/** 発言の行・貼った画像の情報・画像のファイルのうち、いちばん悪いもの（断られた ＞ つながらない ＞ 送っている途中）。mine でなければ undefined */
export function useSendState(m: Sent, mine: boolean): SendState {
  const ids = m.mediaIds.join(",");
  const get = useCallback((): SendState => {
    if (!mine) return undefined;
    const states: SendState[] = [sendStateOf("messages", m.id)];
    for (const id of ids ? ids.split(",") : []) {
      states.push(sendStateOf("media", id));
      const up = uploadStateOf(id);
      states.push(up === "uploading" ? "sending" : up);
    }
    return states.includes("failed") ? "failed" : states.includes("offline") ? "offline" : states.includes("sending") ? "sending" : undefined;
  }, [mine, m.id, ids]);
  return useSyncExternalStore(subscribe, get, () => undefined);
}

/** 断られた行と、置けなかった画像だけを送り直す（ほかの人の画像の情報まで送ると、断られてしまう） */
function resend(m: Sent) {
  const rows: { tbl: Tbl; id: string }[] = [{ tbl: "messages", id: m.id }, ...m.mediaIds.map((id) => ({ tbl: "media" as const, id }))];
  void resendRows(rows.filter((r) => sendStateOf(r.tbl, r.id) === "failed"));
  for (const id of m.mediaIds) retryUpload(id);
}

/** 発言の下に出す、届いていないことの印 */
export function SendStatus({ m, state }: { m: Sent; state: SendState }) {
  if (!state) return null;
  if (state === "failed")
    return (
      <div role="alert" className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-warn">
        <span>送信できませんでした</span>
        <button type="button" onClick={() => resend(m)} className="font-bold underline hover:opacity-80">
          再送信
        </button>
        <button
          type="button"
          onClick={async () => {
            if (await confirmAction("この発言を削除します", "削除")) await deleteMessage(m.id);
          }}
          className="underline hover:opacity-80"
        >
          削除
        </button>
      </div>
    );
  return (
    <div role="status" title={state === "offline" ? "つながったら自動で送ります" : undefined} className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted">
      <span className="block h-3 w-3 animate-spin rounded-full border-2 border-ink/15 border-t-accent" />
      {state === "offline" ? "送信待ち" : "送信中…"}
    </div>
  );
}
