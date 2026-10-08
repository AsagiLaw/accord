"use client";

import { useState } from "react";
import { EmojiPicker } from "@/components/db/meta";
import { mediaIcon } from "@/components/IconMark";
import { MediaPicker } from "@/components/MediaPicker";
import { Popover, type Anchor } from "@/components/ui/Popover";
import { useCurrentUser } from "@/lib/local/session";

/**
 * アイコンを選ぶ：絵文字の一覧（ポップオーバー）か、メディアの画像（1枚）。
 * 選んだら onPick（外したら undefined）。選ぶか閉じると onClose
 */
export function IconPicker({
  anchor,
  roomId,
  hasIcon,
  removeLabel = "標準に戻す",
  onPick,
  onClose,
}: {
  anchor: Anchor;
  roomId: string;
  hasIcon: boolean;
  /** 外すボタンの文字（ページは、外すと標準のアイコンに戻る） */
  removeLabel?: string;
  onPick: (icon: string | undefined) => void;
  onClose: () => void;
}) {
  const me = useCurrentUser();
  const [media, setMedia] = useState(false);
  if (media && me)
    return (
      <MediaPicker
        roomId={roomId}
        userId={me.id}
        single
        pickLabel="アイコンにする"
        onClose={onClose}
        onPick={(ids) => {
          onClose();
          if (ids[0]) onPick(mediaIcon(ids[0]));
        }}
      />
    );
  return (
    <Popover anchor={anchor} onClose={onClose} width={340} label="アイコン">
      <EmojiPicker
        icons
        onPick={(e) => (onPick(e), onClose())}
        onRemove={hasIcon ? () => (onPick(undefined), onClose()) : undefined}
        removeLabel={removeLabel}
        onMedia={() => setMedia(true)}
      />
    </Popover>
  );
}
