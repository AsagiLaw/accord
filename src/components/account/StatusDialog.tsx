"use client";

import { useState } from "react";
import { PopupDialog } from "@/components/ui/Dialog";
import type { Profile } from "@/lib/local/db";
import { updateProfile } from "@/lib/local/rooms";
import { expiryAt, expiryLabel, liveStatus, STATUS_EXPIRY, type StatusExpiry } from "@/lib/status";

/** 期限を選ぶ並び。keep は「今の期限のまま」（期限つきのひとことを直すときだけ出す） */
export function ExpiryChoices({ value, onChange, current }: { value: StatusExpiry | "keep"; onChange: (v: StatusExpiry | "keep") => void; current?: number }) {
  const choices: { id: StatusExpiry | "keep"; label: string }[] = [...(current ? [{ id: "keep" as const, label: `今のまま（${expiryLabel(current)}）` }] : []), ...STATUS_EXPIRY];
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="ひとことを消すまで">
      {choices.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          onClick={() => onChange(c.id)}
          className={`min-h-[34px] rounded-full border px-3 text-sm transition ${value === c.id ? "border-accent bg-tint font-bold" : "border-line hover:bg-tint"}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** 保存する期限：keep なら今の期限、そうでなければ選んだものから決める */
export const resolveExpiry = (v: StatusExpiry | "keep", current?: number) => (v === "keep" ? current : expiryAt(v));

/** ひとことと、自動で消すまでの時間を決める（Discord のカスタムステータスの画面と同じ） */
export function StatusDialog({ me, onClose }: { me: Profile; onClose: () => void }) {
  const current = liveStatus(me) ? me.statusExpiresAt : undefined;
  const [text, setText] = useState(liveStatus(me) ?? "");
  const [expiry, setExpiry] = useState<StatusExpiry | "keep">(current ? "keep" : "never");

  return (
    <PopupDialog title="ひとこと" onClose={onClose} width="max-w-md">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const t = text.trim();
          await updateProfile(me.id, { statusText: t || undefined, statusExpiresAt: t ? resolveExpiry(expiry, current) : undefined });
          onClose();
        }}
      >
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={60} placeholder="例：作業中・〇日まで返信が遅れます" aria-label="ひとこと" className="field" />
        <div>
          <p className="mb-1.5 text-sm font-bold">自動で消すまで</p>
          <ExpiryChoices value={expiry} onChange={setExpiry} current={current} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-sub" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn">保存</button>
        </div>
      </form>
    </PopupDialog>
  );
}
