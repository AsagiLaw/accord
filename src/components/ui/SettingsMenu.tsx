"use client";

import { useState } from "react";
import { IconMark } from "@/components/IconMark";
import { Icon, type IconName } from "@/components/Icon";

// ブロックの設定の画面（Notion のビューの設定と同じ形）。
// 行を押すと中の画面に進み、左上の「‹」で戻る。選ぶものはプルダウンを使わず、中の画面の一覧から押して選ぶ

/** 設定のトップの見出し（「〇〇の設定」） */
export function MenuTitle({ children }: { children: React.ReactNode }) {
  return <p className="px-1 pb-2 text-xs font-bold text-muted">{children}</p>;
}

/** 行の左のアイコン。絵文字があれば絵文字 */
function Lead({ icon, emoji }: { icon?: IconName; emoji?: string }) {
  if (emoji)
    return (
      <span className="grid w-5 shrink-0 place-items-center text-base leading-none">
        <IconMark icon={emoji} />
      </span>
    );
  if (icon)
    return (
      <span className="grid w-5 shrink-0 place-items-center text-muted">
        <Icon name={icon} size={16} />
      </span>
    );
  return null;
}

/** 中の画面に進む行。右に今の値と「›」 */
export function NavRow({ icon, emoji, label, value, onClick, disabled }: { icon?: IconName; emoji?: string; label: string; value?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex min-h-[34px] w-full items-center gap-2 rounded-[8px] px-2 text-left enabled:hover:bg-tint disabled:opacity-50">
      <Lead icon={icon} emoji={emoji} />
      <span className="min-w-0 truncate">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-xs text-muted">{value}</span>
      <Icon name="r" size={16} className="shrink-0 text-muted" />
    </button>
  );
}

/** 中の画面の見出し。左の「‹」で前の画面に戻る */
export function BackHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="mb-1 flex items-center gap-1">
      <button onClick={onBack} aria-label="戻る" title="戻る" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink">
        <Icon name="l" size={18} />
      </button>
      <b className="min-w-0 flex-1 truncate">{title}</b>
    </div>
  );
}

/** 一覧の小見出し。右に「すべて表示」などのボタン */
export function SectionHead({ label, action }: { label: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex items-center px-1 pt-2 pb-0.5 text-xs text-muted">
      <span className="flex-1">{label}</span>
      {action && (
        <button onClick={action.onClick} className="rounded-[6px] px-1.5 py-0.5 text-accent hover:bg-tint">
          {action.label}
        </button>
      )}
    </div>
  );
}

/** 押して選ぶ行。選んでいるものは太字で、右にチェック */
export function OptionRow({
  icon,
  emoji,
  children,
  note,
  selected,
  onClick,
}: {
  icon?: IconName;
  emoji?: string;
  children: React.ReactNode;
  note?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button role="menuitemradio" aria-checked={!!selected} onClick={onClick} className={`flex min-h-[34px] w-full items-center gap-2 rounded-[8px] px-2 py-1 text-left hover:bg-tint ${selected ? "font-bold" : ""}`}>
      <Lead icon={icon} emoji={emoji} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {note && <span className="block truncate text-xs font-normal text-muted">{note}</span>}
      </span>
      {selected && <Icon name="ok" size={16} className="shrink-0 text-accent" />}
    </button>
  );
}

/** オン・オフを切り替える行（右にスイッチ） */
export function ToggleRow({ icon, label, note, on, onChange }: { icon?: IconName; label: string; note?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button role="menuitemcheckbox" aria-checked={on} onClick={() => onChange(!on)} className="flex min-h-[34px] w-full items-center gap-2 rounded-[8px] px-2 py-1 text-left hover:bg-tint">
      <Lead icon={icon} />
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {note && <span className="block text-xs text-muted">{note}</span>}
      </span>
      <span aria-hidden className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** 文字を入れる欄（見出し・後ろに付ける言葉など）。入れたそばから保存する */
export function TextField({ label, defaultValue, onChange, placeholder }: { label: string; defaultValue: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block px-1 pb-2">
      <span className="text-xs text-muted">{label}</span>
      <input defaultValue={defaultValue} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} className="field py-1" />
    </label>
  );
}

/** 一覧を名前で絞り込む欄 */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative mb-1 block px-1">
      <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="field py-1 pl-7" />
    </label>
  );
}

/** 一覧が空のとき */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-xs text-muted">{children}</p>;
}

/** 選ぶ画面の1行分。labelClassName で、文字の大きさの見本などを出せる */
export type Choice<T extends string> = { id: T; label: string; icon?: IconName; emoji?: string; note?: string; labelClassName?: string };

/** 1つを選ぶ画面。search を渡すと名前で絞り込める。選ぶと onPick（戻るのは呼ぶ側で決める） */
export function ChoiceScreen<T extends string>({
  title,
  items,
  selected,
  onPick,
  onBack,
  search,
  section,
  empty = "ありません",
}: {
  title: string;
  items: Choice<T>[];
  selected: string;
  onPick: (id: T) => void;
  onBack: () => void;
  search?: string;
  section?: string;
  empty?: string;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const list = query ? items.filter((x) => x.label.toLowerCase().includes(query)) : items;
  return (
    <div>
      <BackHead title={title} onBack={onBack} />
      {search && <SearchBox value={q} onChange={setQ} placeholder={search} />}
      {section && <SectionHead label={section} />}
      {list.map((x) => (
        <OptionRow key={x.id} icon={x.icon} emoji={x.emoji} note={x.note} selected={x.id === selected} onClick={() => onPick(x.id)}>
          <span className={x.labelClassName}>{x.label}</span>
        </OptionRow>
      ))}
      {!list.length && <EmptyNote>{query ? "見つかりません" : empty}</EmptyNote>}
    </div>
  );
}
