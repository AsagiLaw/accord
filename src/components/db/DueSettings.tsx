"use client";

import { useState } from "react";
import { Select } from "@/components/ui/Select";
import type { Database } from "@/lib/local/db";
import { notifyPermission, setDueNotify, useDueNotify } from "@/lib/local/dueNotify";
import { updateDatabase } from "@/lib/local/requests";
import { useCurrentUser } from "@/lib/local/session";
import { canBeDue, dueDaysOf, dueProp } from "@/lib/requests/due";
import { isBackdropClick } from "@/components/ui/backdrop";

/** 納期のお知らせの設定：どの日付を納期にするか・何日前から近いとするか（データベースごと）と、この端末でブラウザの通知を出すか */
export function DueSettings({ database, onClose }: { database: Database; onClose: () => void }) {
  const me = useCurrentUser();
  const notifyOn = useDueNotify(me?.id);
  // "" は自動（名前から選ぶ）、"none" はお知らせしない
  const [prop, setProp] = useState<string>(database.dueProp === null ? "none" : (database.dueProp ?? ""));
  const [days, setDays] = useState(String(dueDaysOf(database)));
  const [denied, setDenied] = useState(false);
  const auto = dueProp({ props: database.props, dueProp: undefined });
  const choices = database.props.filter((p) => canBeDue(database, p));

  const save = async () => {
    const n = Math.max(0, Math.min(60, Math.round(Number(days) || 0)));
    await updateDatabase(database.id, { dueProp: prop === "none" ? null : prop || undefined, dueDays: n });
    onClose();
  };

  return (
    <div className="sheet-backdrop fixed inset-0 z-[56] flex items-end justify-center bg-black/50 sm:items-center" onClick={(e) => isBackdropClick(e) && onClose()} data-overlay="">
      <div role="dialog" aria-modal="true" aria-label="納期のお知らせ" data-name="納期のお知らせの設定" className="flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]">
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="font-bold">納期のお知らせ</h3>
          <div className="flex gap-2">
            <button className="btn-sub" onClick={onClose}>
              キャンセル
            </button>
            <button className="btn" onClick={save}>
              保存
            </button>
          </div>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-28 shrink-0">納期の項目</span>
            <Select
              value={prop}
              onChange={setProp}
              label="納期の項目"
              options={[{ value: "", label: `自動（${auto?.name ?? "なし"}）` }, { value: "none", label: "お知らせしない" }, ...choices.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-28 shrink-0">近いとする日</span>
            <input type="number" min={0} max={60} value={days} onChange={(e) => setDays(e.target.value)} disabled={prop === "none"} className="field h-9 w-20 py-1" />
            <span>日前から</span>
          </label>
          {/* ブラウザの通知：人と端末ごと（すぐに切り替わる） */}
          <div className="border-t border-line pt-4">
            <button
              role="switch"
              aria-checked={notifyOn}
              disabled={!me || notifyPermission() === "unsupported"}
              onClick={async () => {
                if (!me) return;
                const ok = await setDueNotify(me.id, !notifyOn);
                setDenied(!notifyOn && !ok);
              }}
              className="flex w-full items-center gap-2 text-left disabled:opacity-50"
            >
              <span className="flex-1">このブラウザに通知を出す</span>
              <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${notifyOn ? "bg-accent" : "bg-line"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${notifyOn ? "left-[18px]" : "left-0.5"}`} />
              </span>
            </button>
            {(denied || (notifyPermission() === "denied" && !notifyOn)) && <p className="mt-1 text-warn">ブラウザで通知が止められています</p>}
            {notifyPermission() === "unsupported" && <p className="mt-1 text-muted">このブラウザは通知を使えません</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
