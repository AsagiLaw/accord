"use client";

import { Avatar, PRESENCE, PRESENCE_CHOICES } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { MenuDivider, MenuItem, MenuLabel } from "@/components/ui/Popover";
import type { Presence, Profile } from "@/lib/local/db";
import { updateProfile, useAllProfiles } from "@/lib/local/rooms";
import { useNow, useShownPresence } from "@/lib/local/presence";
import { expiryLabel, liveStatus } from "@/lib/status";
import { ProfileExtras, UsernameLine, WorkStatusChip } from "./ProfileExtras";
import { setCurrentUser, useSignedInIds } from "@/lib/local/session";
import { authMode } from "@/lib/auth/mode";
import { useRouter } from "next/navigation";
import { useLogout } from "./MyAccountSection";


/** 状態の印だけ（メニューの行の左に置く） */
const Dot = ({ p }: { p: Presence }) => <span className={`h-2.5 w-2.5 rounded-full ${PRESENCE[p].dot}`} />;

/**
 * 左下の欄を押すと出る、自分のプロフィールのカード（Discord と同じ）。
 * 上に色の帯と大きなアイコン、その下に名前とひとこと。状態とひとことはここで変えられる
 */
export function ProfileCard({ me, onEdit, onEditStatus, onDone }: { me: Profile; onEdit: () => void; onEditStatus: () => void; onDone: () => void }) {
  // 選んでいる状態（メニューの印）と、今の見え方（操作が無ければ退席中になる）
  const presence = me.presence ?? "online";
  const shown = useShownPresence(me.id)(me);
  const profiles = useAllProfiles();
  const router = useRouter();
  const logout = useLogout(me);
  // このブラウザでログインしているアカウント（ログインした順）
  const signedIn = useSignedInIds();
  const accounts = signedIn.flatMap((id) => profiles?.find((p) => p.id === id) ?? []);

  const now = useNow();
  const status = liveStatus(me, now);

  return (
    <div data-name="プロフィールのカード">
      <div aria-hidden className="-mx-1.5 -mt-1.5 h-16 rounded-t-[11px] bg-accent" />
      <div className="-mt-10 px-2.5">
        <span className="inline-flex rounded-full border-[5px] border-card bg-card">
          <Avatar name={me.displayName} src={me.avatar} size={76} presence={shown} />
        </span>
        <p className="mt-1 truncate text-lg font-bold">{me.displayName}</p>
        <UsernameLine username={me.username} />
        {status ? (
          <p className="flex items-start gap-1 text-sm">
            <span className="min-w-0 flex-1 break-words">
              {status}
              {/* 自動で消える時刻 */}
              {me.statusExpiresAt && <span className="block text-xs text-muted">{expiryLabel(me.statusExpiresAt, now)}表示</span>}
            </span>
            <button
              type="button"
              aria-label="ひとことを消す"
              title="ひとことを消す"
              onClick={() => updateProfile(me.id, { statusText: undefined, statusExpiresAt: undefined })}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink"
            >
              <Icon name="x" size={14} />
            </button>
          </p>
        ) : null}
        {me.workStatus && (
          <div className="mt-1 flex text-xs">
            <WorkStatusChip status={me.workStatus} />
          </div>
        )}
        <ProfileExtras person={me} />
      </div>

      <div className="mt-2 rounded-[10px] bg-bg p-1">
        <MenuItem icon={<Icon name="edit" size={16} />} onClick={onEdit}>
          プロフィールを編集
        </MenuItem>
        <MenuItem icon={<Icon name="smile" size={16} />} onClick={onEditStatus}>
          {status ? "ひとことを変える" : "ひとことを設定"}
        </MenuItem>
        <MenuDivider />
        <MenuLabel>状態</MenuLabel>
        {PRESENCE_CHOICES.map((p) => (
          <MenuItem
            key={p}
            icon={<Dot p={p} />}
            active={p === presence}
            right={p === presence ? <Icon name="check" size={16} className="text-accent" /> : undefined}
            onClick={() => updateProfile(me.id, { presence: p })}
          >
            {PRESENCE[p].label}
            {p === "dnd" && <span className="block text-xs font-normal text-muted">未読の印を灰色にして、通知を控えます</span>}
            {p === "invisible" && <span className="block text-xs font-normal text-muted">ほかの人にはオフラインに見えます</span>}
          </MenuItem>
        ))}
      </div>

      {/* アカウント：ローカル版だけ、このブラウザでログインしているアカウントを切り替えられる（2人分の動きを1台で試す） */}
      <div data-name="アカウント" className="mt-1.5 rounded-[10px] bg-bg p-1">
        {authMode === "local" && (
          <>
            <MenuLabel>アカウントを切り替え（ローカル版のみ）</MenuLabel>
            {accounts.map((p) => (
              <MenuItem
                key={p.id}
                icon={<Avatar name={p.displayName} src={p.avatar} size={20} />}
                active={p.id === me.id}
                right={p.id === me.id ? <Icon name="check" size={16} className="text-accent" /> : undefined}
                onClick={() => {
                  if (p.id !== me.id) setCurrentUser(p.id);
                  onDone();
                }}
              >
                {p.displayName}
              </MenuItem>
            ))}
            <MenuItem
              icon={<Icon name="add" size={16} />}
              onClick={() => {
                onDone();
                router.push(`/login?add=1&next=${encodeURIComponent(window.location.pathname)}`);
              }}
            >
              アカウントを追加
            </MenuItem>
            <MenuDivider />
          </>
        )}
        <MenuItem
          icon={<Icon name="out" size={16} />}
          danger
          onClick={() => {
            onDone();
            void logout();
          }}
        >
          ログアウト
        </MenuItem>
      </div>
    </div>
  );
}
