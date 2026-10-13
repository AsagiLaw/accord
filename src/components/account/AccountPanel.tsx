"use client";

import { useEffect, useState } from "react";
import { Avatar, PRESENCE } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Popover, usePopover } from "@/components/ui/Popover";
import type { Profile } from "@/lib/local/db";
import { useNow, usePresenceBeacon, useShownPresence } from "@/lib/local/presence";
import { updateProfile } from "@/lib/local/rooms";
import { liveStatus } from "@/lib/status";
import { AccountSettings, type SettingsSection } from "./AccountSettings";
import { ProfileCard } from "./ProfileCard";
import { StatusDialog } from "./StatusDialog";
import { OPEN_ACCOUNT_SETTINGS } from "./UserCard";

/**
 * Discord の左下と同じ、自分のアカウントの欄：アイコン（状態の印つき）・名前・ひとこと、右に設定の歯車。
 * 名前のところを押すとプロフィールのカード、歯車を押すとアカウントの設定が開く
 */
export function AccountPanel({ me }: { me: Profile }) {
  const card = usePopover();
  // 開いているアカウントの設定（歯車からはマイアカウント、「プロフィールを編集」からはプロフィール）
  // 開いた人を覚えておき、アカウントが替わったら閉じる（ログアウトして、ほかのアカウントに替わったときなど）
  const [opened, setOpened] = useState<{ section: SettingsSection; userId: string } | null>(null);
  const settings = opened?.userId === me.id ? opened.section : null;
  const setSettings = (section: SettingsSection | null) => setOpened(section ? { section, userId: me.id } : null);
  const [statusEdit, setStatusEdit] = useState(false);
  const now = useNow();
  const status = liveStatus(me, now);
  // 期限を過ぎたひとことは、消しておく（ほかの人の画面では、期限を過ぎた時点で出なくなっている）
  const expired = !!me.statusText && !status;
  useEffect(() => {
    if (expired) void updateProfile(me.id, { statusText: undefined, statusExpiresAt: undefined });
  }, [expired, me.id]);
  // 今の見え方（操作が無ければ自動で退席中になる）。このタブを開いている間は「開いている」と知らせ続ける
  usePresenceBeacon(me.id);
  // 自分のプロフィールのカード（メンバー一覧やチャットから開いたもの）の「プロフィールを編集」
  useEffect(() => {
    const open = () => setOpened({ section: "profile", userId: me.id });
    window.addEventListener(OPEN_ACCOUNT_SETTINGS, open);
    return () => window.removeEventListener(OPEN_ACCOUNT_SETTINGS, open);
  }, [me.id]);
  const presence = useShownPresence(me.id)(me);

  return (
    <div data-name="アカウントの欄" className="flex items-center gap-1 rounded-[12px] border border-line bg-card p-1 shadow-sm">
      <button
        type="button"
        data-name="自分のプロフィール"
        aria-haspopup="dialog"
        aria-expanded={!!card.anchor}
        aria-label={`${me.displayName}（${PRESENCE[presence].label}）のプロフィール`}
        onClick={card.toggle}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-[8px] px-1.5 py-1 text-left transition hover:bg-tint ${card.anchor ? "bg-tint" : ""}`}
      >
        <Avatar name={me.displayName} src={me.avatar} size={34} presence={presence} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-bold">{me.displayName}</span>
          {/* ひとことが無ければ、今の状態を出す */}
          <span className="block truncate text-xs text-muted">{status || PRESENCE[presence].label}</span>
        </span>
      </button>
      <button
        type="button"
        data-name="アカウントの設定"
        aria-label="アカウントの設定"
        title="アカウントの設定"
        onClick={() => setSettings("account")}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] text-muted transition hover:bg-tint hover:text-ink"
      >
        <Icon name="gear" size={20} />
      </button>

      <Popover anchor={card.anchor} onClose={card.close} width={300} label="プロフィールのカード">
        <ProfileCard
          me={me}
          onEdit={() => {
            card.close();
            setSettings("profile");
          }}
          onEditStatus={() => {
            card.close();
            setStatusEdit(true);
          }}
          onDone={card.close}
        />
      </Popover>
      {statusEdit && <StatusDialog me={me} onClose={() => setStatusEdit(false)} />}
      {settings && <AccountSettings me={me} initial={settings} onClose={() => setSettings(null)} />}
    </div>
  );
}
