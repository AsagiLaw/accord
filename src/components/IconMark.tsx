"use client";

import { Icon, isIconName, type IconName } from "@/components/Icon";
import { ThumbImage } from "@/components/ThumbImage";

/** シンプルなアイコンの色（Notion と同じくらいの、明るい画面でも暗い画面でも読める色）。default は文字の色 */
export const ICON_COLORS: { id: string; label: string; color: string }[] = [
  { id: "", label: "文字の色", color: "var(--ink)" },
  { id: "gray", label: "グレー", color: "#91918e" },
  { id: "brown", label: "ブラウン", color: "#a27763" },
  { id: "orange", label: "オレンジ", color: "#cb7b37" },
  { id: "yellow", label: "イエロー", color: "#c29243" },
  { id: "green", label: "グリーン", color: "#4f9768" },
  { id: "blue", label: "ブルー", color: "#447acb" },
  { id: "purple", label: "パープル", color: "#865db0" },
  { id: "pink", label: "ピンク", color: "#ba4a78" },
  { id: "red", label: "レッド", color: "#be524b" },
];
export const iconColor = (id?: string) => ICON_COLORS.find((c) => c.id === (id ?? ""))?.color ?? "var(--ink)";

/** アイコンに選べるシンプルな形 */
export const SIMPLE_ICONS: IconName[] = [
  "note",
  "folder",
  "book",
  "bookmark",
  "db",
  "table",
  "list",
  "img",
  "camera",
  "brush",
  "palette",
  "edit",
  "chat",
  "mail",
  "phone",
  "send",
  "ppl",
  "person",
  "home",
  "work",
  "school",
  "place",
  "calendar",
  "clock",
  "bell",
  "flag",
  "pin",
  "tag",
  "star",
  "heart",
  "check",
  "bulb",
  "bolt",
  "chart",
  "money",
  "cart",
  "music",
  "cloud",
  "sun",
  "moon",
  "smile",
  "link",
];

/** シンプルなアイコンの形（"icon:形" か "icon:形:色"） */
const SIMPLE_ICON = "icon:";
export const simpleIcon = (name: IconName, color?: string) => `${SIMPLE_ICON}${name}${color ? `:${color}` : ""}`;
const simpleOf = (icon?: string) => {
  if (!icon?.startsWith(SIMPLE_ICON)) return undefined;
  const [name, color] = icon.slice(SIMPLE_ICON.length).split(":");
  return isIconName(name) ? { name, color } : undefined;
};

/** ページにアイコンを付けていないときに出す、標準のアイコン（Notion と同じく、アイコンが無い状態は作らない） */
export const DEFAULT_PAGE_ICON = simpleIcon("note", "gray");

/** アイコンにメディアの画像を使うときの形（"media:画像のID"）。それ以外は絵文字 */
const MEDIA_ICON = "media:";
export const mediaIcon = (mediaId: string) => `${MEDIA_ICON}${mediaId}`;
export const mediaIconId = (icon?: string) => (icon?.startsWith(MEDIA_ICON) ? icon.slice(MEDIA_ICON.length) : undefined);

/**
 * アイコン（絵文字、シンプルなアイコン、またはメディアの画像）を出す。画像とシンプルなアイコンは文字と同じ大きさ（1em）。
 * アイコンが無いときは fallback を出す
 */
export function IconMark({ icon, fallback = null, size = "1em" }: { icon?: string; fallback?: React.ReactNode; size?: string | number }) {
  const simple = simpleOf(icon);
  if (simple)
    return (
      <span className="inline-grid shrink-0 place-items-center align-[-0.15em] [&>svg]:h-full [&>svg]:w-full" style={{ width: size, height: size, color: iconColor(simple.color) }}>
        <Icon name={simple.name} />
      </span>
    );
  const mid = mediaIconId(icon);
  if (mid)
    return (
      <span className="inline-block shrink-0 overflow-hidden rounded-[22%] align-[-0.15em]" style={{ width: size, height: size }}>
        <ThumbImage id={mid} alt="" />
      </span>
    );
  if (icon) return <>{icon}</>;
  return <>{fallback}</>;
}
