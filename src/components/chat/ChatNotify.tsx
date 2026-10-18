"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Popover, usePopover } from "@/components/ui/Popover";
import { setChatMuted, useChatMuted } from "@/lib/local/chat";
import { setChatNotify, useChatNotify } from "@/lib/local/chatNotify";
import { useCurrentUser } from "@/lib/local/session";
import { notifyPermission } from "@/lib/notify";

/** オン・オフのスイッチ（納期の通知の設定と同じ形） */
export function NotifySwitch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={onClick} className="flex w-full items-center gap-2 text-left disabled:opacity-50">
      <span className="flex-1">{label}</span>
      <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** 通知が出せないときの説明（ブラウザが止めている・使えない） */
export function NotifyBlocked({ denied }: { denied?: boolean }) {
  const p = notifyPermission();
  if (p === "unsupported")
    return <p className="text-muted">このブラウザは通知を使えません。iPhone は、Safari の共有ボタンから「ホーム画面に追加」したアプリでだけ使えます。</p>;
  if (denied || p === "denied") return <p className="text-warn">ブラウザで通知が止められています。ブラウザのサイトの設定で、通知を許可してください。</p>;
  return null;
}

/**
 * チャットの上のバー（とチャットのブロックの右上）に置くベルのボタン。押すと、このチャットの通知を切る・入れるメニュー。
 * この端末で通知を出す設定になっていなければ、ここからオンにできる（ブラウザの許可を求める）。通知を切っているときは、ベルに斜線
 */
export function ChatNotifyButton({ chatId, compact }: { chatId: string; compact?: boolean }) {
  const me = useCurrentUser();
  const muted = useChatMuted(chatId, me?.id);
  const deviceOn = useChatNotify(me?.id);
  const pop = usePopover();
  const [denied, setDenied] = useState(false);
  if (!me) return null;
  const label = muted ? "このチャットの通知を切っています" : "このチャットの通知";
  return (
    <>
      <button
        type="button"
        data-name="チャットの通知"
        aria-label={label}
        title={label}
        onClick={pop.toggle}
        className={`grid shrink-0 place-items-center text-muted hover:bg-tint hover:text-ink ${compact ? "h-6 w-6 rounded-full" : "h-7 w-7 rounded-[8px]"}`}
      >
        <Icon name={muted ? "bellOff" : "bell"} size={compact ? 15 : 18} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={280} align="end" label="チャットの通知">
          <div className="space-y-3 p-2 text-sm">
            <NotifySwitch on={!muted} label="このチャットを通知する" onClick={() => void setChatMuted(chatId, me.id, !muted)} />
            <p className="text-xs text-muted">切っても、未読の数は出ます。どの端末でも同じです。</p>
            {!deviceOn && (
              <div className="space-y-2 border-t border-line pt-3">
                <p>この端末では、チャットの通知がオフです。</p>
                <button
                  className="btn-sub w-full"
                  disabled={notifyPermission() === "unsupported"}
                  onClick={async () => setDenied(!(await setChatNotify(me.id, true)))}
                >
                  <Icon name="bell" size={16} />
                  この端末で通知を受け取る
                </button>
                <NotifyBlocked denied={denied} />
              </div>
            )}
            {deviceOn && me.presence === "dnd" && <p className="border-t border-line pt-3 text-xs text-muted">取り込み中の間は、通知を出しません。</p>}
          </div>
        </Popover>
      )}
    </>
  );
}
