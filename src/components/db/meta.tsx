"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { ICON_COLORS, SIMPLE_ICONS, iconColor, simpleIcon } from "@/components/IconMark";
import type { PropType, Property, TagColor, ViewType } from "@/lib/local/db";

// データベースの見た目に使う決まりごと（アイコン・名前・色）

export const PROP_TYPES: Record<PropType, { label: string; icon: IconName; note: string }> = {
  title: { label: "タイトル", icon: "text", note: "ページの名前" },
  text: { label: "テキスト", icon: "text", note: "自由な文章" },
  number: { label: "数値", icon: "hash", note: "金額・枚数・％など" },
  date: { label: "日付", icon: "calendar", note: "納期・受付日など" },
  select: { label: "選択", icon: "status", note: "1つだけ選ぶ" },
  multiselect: { label: "マルチセレクト", icon: "list", note: "いくつでも選ぶ" },
  status: { label: "ステータス", icon: "status", note: "進行中・完了など" },
  user: { label: "ユーザー", icon: "person", note: "ルームのメンバー" },
  media: { label: "メディア", icon: "img", note: "メディアの画像" },
  checkbox: { label: "チェックボックス", icon: "checkbox", note: "できた・できていない" },
  url: { label: "URL", icon: "link", note: "Webページのリンク" },
  email: { label: "メール", icon: "mail", note: "メールアドレス" },
  phone: { label: "電話", icon: "phone", note: "電話番号" },
  created: { label: "作成日時", icon: "clock", note: "作ったときに自動で入る" },
  edited: { label: "更新日時", icon: "clock", note: "変えたときに自動で入る" },
  stage: { label: "工程", icon: "timeline", note: "プランごとの工程と％" },
  chat: { label: "チャット", icon: "chat", note: "ページごとの会話" },
  imageChat: { label: "イメージチャット", icon: "ppl", note: "ページごとのやり取り再現" },
};

/** チャットの項目（表やボード、詳細の入力欄には出さない） */
export const isChatProp = (p: { type: PropType }) => p.type === "chat" || p.type === "imageChat";

export const VIEW_TYPES: Record<ViewType, { label: string; icon: IconName; note: string }> = {
  table: { label: "テーブル", icon: "table", note: "表で一覧する。その場で編集できる" },
  board: { label: "ボード", icon: "board", note: "ステータスなどで列に分け、ドラッグで動かす" },
  list: { label: "リスト", icon: "list", note: "進み具合と期限が分かる一覧" },
  gallery: { label: "ギャラリー", icon: "gallery", note: "画像をカードで並べる" },
  progress: { label: "割合", icon: "chart", note: "進み具合をゲージで並べる" },
  calendar: { label: "カレンダー", icon: "calendar", note: "日付と工程の期限を、月（マンスリー）か週（ウィークリー）ごとに" },
  timeline: { label: "タイムライン", icon: "timeline", note: "開始日から納期までの帯" },
  summary: { label: "集計", icon: "chart", note: "合計と月ごとの推移" },
};

export function PropIcon({ type, size = 14 }: { type: PropType; size?: number }) {
  return <Icon name={PROP_TYPES[type].icon} size={size} className="shrink-0 text-muted" />;
}

// ---- 選択肢の色 ----

export const TAG_COLORS: Record<TagColor, { label: string; hue: string }> = {
  gray: { label: "灰色", hue: "#8a8a8a" },
  brown: { label: "茶色", hue: "#9a6a4b" },
  orange: { label: "オレンジ", hue: "#d9730d" },
  yellow: { label: "黄色", hue: "#c29a00" },
  green: { label: "緑", hue: "#2f9a5f" },
  blue: { label: "青", hue: "#2f7ad1" },
  purple: { label: "紫", hue: "#8f5bd1" },
  pink: { label: "ピンク", hue: "#c94f98" },
  red: { label: "赤", hue: "#d44c47" },
};

/** 選択肢の色。決まっていなければ、名前から自動で決める（よく使う言葉は意味に合う色） */
export function colorOf(prop: Property | undefined, option: string): TagColor {
  const c = prop?.colors?.[option];
  if (c) return c;
  if (/完了|済|done/i.test(option)) return "green";
  if (/進行|作業|対応/.test(option)) return "blue";
  if (/保留|待ち|確認/.test(option)) return "yellow";
  if (/中止|キャンセル|NG/i.test(option)) return "red";
  const keys = Object.keys(TAG_COLORS) as TagColor[];
  let h = 0;
  for (const ch of option) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return keys[1 + (h % (keys.length - 1))];
}

/** 色付きのタグ。背景は色を薄く、文字は濃くして、ホワイトでもダークでも読めるようにする */
export function Tag({ color, children, onRemove }: { color: TagColor; children: React.ReactNode; onRemove?: () => void }) {
  const hue = TAG_COLORS[color].hue;
  return (
    <span
      className="inline-flex max-w-full items-center gap-0.5 rounded-[6px] px-1.5 py-px text-[13px] leading-5 whitespace-nowrap"
      style={{ background: `color-mix(in srgb, ${hue} 22%, transparent)`, color: `color-mix(in srgb, ${hue} 75%, var(--ink))` }}
    >
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          aria-label="外す"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 opacity-60 hover:opacity-100"
        >
          ×
        </button>
      )}
    </span>
  );
}

// ---- 絵文字のアイコン ----

const EMOJI = {
  よく使う: ["📄", "📝", "📌", "⭐", "🔥", "✅", "❗", "💡", "🎨", "🖌️", "✏️", "🖼️", "📷", "🎬", "📦", "💰", "💴", "📅", "⏰", "📣"],
  依頼: ["🙋", "🤝", "📨", "💌", "🧾", "📋", "🗂️", "📁", "🏷️", "🎁", "🛒", "💳", "📈", "📊", "🗓️", "⏳", "🚚", "🎯", "🔖", "🆕"],
  顔: ["😀", "😊", "🥰", "😎", "🤔", "😴", "😭", "😡", "🥳", "😇", "🙂", "😆", "😍", "🤩", "😳", "🥺", "😤", "🤗", "🙃", "😺"],
  もの: ["🌸", "🌙", "☀️", "🌈", "❄️", "🍀", "🌊", "🍰", "☕", "🍙", "🐱", "🐶", "🐰", "🦊", "🐻", "🐧", "🦋", "🎵", "🎮", "📚"],
  記号: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🤍", "🖤", "⚪", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "◆", "★", "●", "▲"],
};

/**
 * アイコンを選ぶ。絵文字は一覧から（無いものは入力欄に貼り付けて使える）。
 * icons があれば「アイコン」（シンプルな形と色）、onMedia があれば「画像」（メディアから）も選べる（Notion と同じく上のタブで切り替え）
 */
export function EmojiPicker({
  onPick,
  onRemove,
  onMedia,
  icons,
  removeLabel = "外す",
}: {
  onPick: (emoji: string) => void;
  onRemove?: () => void;
  onMedia?: () => void;
  icons?: boolean;
  removeLabel?: string;
}) {
  const [custom, setCustom] = useState("");
  const [tab, setTab] = useState<"emoji" | "icon">("emoji");
  const [color, setColor] = useState("");
  const tabbed = icons || !!onMedia;
  const tabClass = (on: boolean) => `rounded-[6px] px-2 py-1 text-sm ${on ? "bg-tint font-bold" : "text-muted hover:bg-tint/60 hover:text-ink"}`;
  return (
    <div className="space-y-2 p-1">
      {tabbed && (
        <div className="flex items-center gap-0.5 border-b border-line pb-1.5" role="tablist" aria-label="アイコンの種類">
          <button role="tab" aria-selected={tab === "emoji"} className={tabClass(tab === "emoji")} onClick={() => setTab("emoji")}>
            絵文字
          </button>
          {icons && (
            <button role="tab" aria-selected={tab === "icon"} className={tabClass(tab === "icon")} onClick={() => setTab("icon")}>
              アイコン
            </button>
          )}
          {onMedia && (
            <button className={tabClass(false)} onClick={onMedia} title="メディアから画像を選ぶ">
              画像
            </button>
          )}
          <span className="flex-1" />
          {onRemove && (
            <button onClick={onRemove} className="rounded-[6px] px-2 py-1 text-xs text-muted hover:bg-tint hover:text-ink">
              {removeLabel}
            </button>
          )}
        </div>
      )}
      {tab === "icon" ? (
        <>
          {/* 色を選んでから、形を押す */}
          <div className="flex flex-wrap gap-1.5 px-0.5" role="radiogroup" aria-label="アイコンの色">
            {ICON_COLORS.map((c) => (
              <button
                key={c.id || "default"}
                role="radio"
                aria-checked={color === c.id}
                aria-label={c.label}
                title={c.label}
                onClick={() => setColor(c.id)}
                className={`h-5 w-5 rounded-full ${color === c.id ? "ring-2 ring-accent ring-offset-2 ring-offset-card" : ""}`}
                style={{ background: c.color }}
              />
            ))}
          </div>
          <div className="grid grid-cols-8 gap-0.5" style={{ color: iconColor(color) }}>
            {SIMPLE_ICONS.map((n) => (
              <button key={n} aria-label={n} onClick={() => onPick(simpleIcon(n, color))} className="grid h-8 w-8 place-items-center rounded-[6px] hover:bg-tint">
                <Icon name={n} size={20} />
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {Object.entries(EMOJI).map(([group, list]) => (
            <div key={group}>
              <div className="mb-0.5 text-xs text-muted">{group}</div>
              <div className="grid grid-cols-10 gap-0.5">
                {list.map((e) => (
                  <button key={e} aria-label={e} onClick={() => onPick(e)} className="grid h-7 w-7 place-items-center rounded-[6px] text-lg hover:bg-tint">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const first = Array.from(new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(custom.trim()))[0]?.segment;
              if (first) onPick(first);
            }}
          >
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="ほかの絵文字を貼り付け" className="field py-1" aria-label="ほかの絵文字" />
            <button className="btn-sub shrink-0 px-3">使う</button>
          </form>
        </>
      )}
      {!tabbed && onRemove && (
        <button onClick={onRemove} className="w-full rounded-[8px] py-1 text-sm text-muted hover:bg-tint">
          アイコンを外す
        </button>
      )}
    </div>
  );
}
