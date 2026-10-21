"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ThumbImage } from "@/components/ThumbImage";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover } from "@/components/ui/Popover";
import { confirmAction } from "@/components/ui/overlay";
import type { Database, DbPage, Property, TagColor } from "@/lib/local/db";
import { stageOf, stagesFor } from "@/lib/requests/stages";
import { addOption, deleteOption, renameOption, setOptionColor, setOptionGroup, setOptionValue, useDatabase } from "@/lib/local/requests";
import { STATUS_GROUPS, statusGroupOf } from "@/lib/requests/props";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { formatValue } from "@/lib/requests/logic";
import { TAG_COLORS, Tag, colorOf } from "./meta";
import { SubPageChip, subTargetOf } from "./PageLink";
import { ChatSummary } from "./PropChat";

/** 値を見せる（選択肢は色付きのタグ、ユーザーは名前、メディアは小さな画像） */
export function PropValue({
  prop,
  value,
  members,
  empty,
  page,
}: {
  prop: Property;
  value: unknown;
  members: MemberWithProfile[];
  empty?: React.ReactNode;
  /** 工程の％を出すのに使う（「ページ」の項目は、ID などで別ページを開く） */
  page?: Pick<DbPage, "values"> & Partial<Pick<DbPage, "id" | "dbId" | "roomId">>;
}) {
  // 「ページ」の項目は、押すと別ページを開くボタン
  if (prop.type === "page") return <SubPageChip target={subTargetOf(page, prop.id)} name={prop.name} inline />;
  // チャットの項目は、発言の数と最後の発言（会話そのものは、表のセルを押すとポップアップで開く）
  if (prop.type === "chat" || prop.type === "imageChat") return <ChatSummary chatId={typeof value === "string" ? value : ""} />;
  if (prop.type === "checkbox") {
    return (
      <span aria-label={value ? "チェックあり" : "チェックなし"} className={`grid h-[18px] w-[18px] place-items-center rounded-[5px] border ${value ? "border-accent bg-accent text-accent-ink" : "border-muted"}`}>
        {value ? <Icon name="ok" size={14} /> : null}
      </span>
    );
  }
  const blank = value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
  if (blank) return <>{empty ?? null}</>;
  switch (prop.type) {
    case "stage": {
      const st = page ? stageOf(prop, page) : null;
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Tag color={st && st.pct >= 100 ? "green" : "blue"}>{String(value)}</Tag>
          {st?.current && <span className="text-xs text-muted">{st.pct}%</span>}
        </span>
      );
    }
    case "url":
    case "email":
    case "phone": {
      const v = String(value);
      const href = prop.type === "url" ? (/^https?:\/\//.test(v) ? v : `https://${v}`) : prop.type === "email" ? `mailto:${v}` : `tel:${v}`;
      return (
        <a href={href} target={prop.type === "url" ? "_blank" : undefined} rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate text-accent underline underline-offset-2">
          {v}
        </a>
      );
    }
    case "select":
    case "status":
      return <Tag color={colorOf(prop, String(value))}>{String(value)}</Tag>;
    case "multiselect":
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((o) => (
            <Tag key={o} color={colorOf(prop, o)}>
              {o}
            </Tag>
          ))}
        </span>
      );
    case "user": {
      const name = members.find((m) => m.userId === value)?.displayName ?? "退出した人";
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-ink">{Array.from(name)[0]}</span>
          {name}
        </span>
      );
    }
    case "media":
      return (
        <span className="flex gap-1">
          {(value as string[]).slice(0, 4).map((id) => (
            <span key={id} className="h-7 w-7 shrink-0 overflow-hidden rounded-[5px]">
              <ThumbImage id={id} alt="" />
            </span>
          ))}
        </span>
      );
    default:
      return <>{formatValue(prop, value)}</>;
  }
}

/**
 * Notion のような選択肢の編集。入力で絞り込み、無ければ Enter で作る。
 * 選択肢の「…」から名前・色・削除を変えられる。
 */
export function SelectEditor({
  database: given,
  prop: givenProp,
  value,
  onChange,
  onDone,
}: {
  database: Database;
  prop: Property;
  value: unknown;
  onChange: (v: unknown) => void;
  onDone?: () => void;
}) {
  // 開いている間に色や名前を変えたら、すぐ出るように、いつも保存されている最新の項目を使う（渡された項目は開いたときのもの）
  const database = useDatabase(given.id) ?? given;
  const prop = database.props.find((p) => p.id === givenProp.id) ?? givenProp;
  const multi = prop.type === "multiselect";
  const selected = multi ? (Array.isArray(value) ? (value as string[]) : []) : value ? [String(value)] : [];
  const [query, setQuery] = useState("");
  const options = prop.options ?? [];
  const shown = options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));
  const canCreate = query.trim() && !options.includes(query.trim());
  const optionMenu = usePopover();
  const [editing, setEditing] = useState<string | null>(null);

  const pick = (o: string) => {
    if (multi) onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
    else {
      onChange(selected[0] === o && prop.type === "select" ? "" : o);
      onDone?.();
    }
  };
  /** 選択肢1つの行（押すと選ぶ。右に付けた数と「…」） */
  const row = (o: string) => (
    <div key={o} className="group flex items-center">
      <button onClick={() => pick(o)} className="flex min-h-[32px] min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 hover:bg-tint">
        <Tag color={colorOf(prop, o)}>{o}</Tag>
        {prop.optionValues?.[o] !== undefined && <span className="text-xs text-muted">{prop.optionValues[o]}</span>}
        {selected.includes(o) && <Icon name="ok" size={14} className="ml-auto text-muted" />}
      </button>
      <button
        aria-label={`「${o}」を編集`}
        onClick={(e) => {
          setEditing(o);
          optionMenu.open(e);
        }}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:bg-tint focus:opacity-100 max-md:opacity-60 pointer-coarse:opacity-60"
      >
        <Icon name="dots" size={14} />
      </button>
    </div>
  );
  const create = async () => {
    const name = query.trim();
    if (!name) return;
    await addOption(database.id, prop.id, name);
    setQuery("");
    pick(name);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-line p-1.5">
        {selected.map((o) => (
          <Tag key={o} color={colorOf(prop, o)} onRemove={() => onChange(multi ? selected.filter((x) => x !== o) : "")}>
            {o}
          </Tag>
        ))}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (shown[0] && !canCreate) pick(shown[0]);
            else void create();
          }}
          placeholder={options.length ? "選ぶか、新しく入力" : "選択肢を入力して Enter"}
          className="min-w-24 flex-1 bg-transparent px-1 outline-none"
          aria-label="選択肢を探す・作る"
        />
      </div>
      <MenuLabel>{multi ? "いくつでも選べます" : "1つ選んでください"}</MenuLabel>
      {/* ステータスは、グループ（未着手・進行中・完了）ごとに分けて並べる */}
      {prop.type === "status"
        ? STATUS_GROUPS.map((g) => {
            const list = shown.filter((o) => statusGroupOf(prop, o) === g.id);
            return list.length ? (
              <div key={g.id}>
                <p className="px-2 pt-1.5 text-[11px] text-muted">{g.label}</p>
                {list.map(row)}
              </div>
            ) : null;
          })
        : shown.map(row)}
      {canCreate && (
        <button onClick={create} className="flex min-h-[32px] w-full items-center gap-2 rounded-[8px] px-2 hover:bg-tint">
          <span className="text-muted">作成</span>
          <Tag color={colorOf(prop, query.trim())}>{query.trim()}</Tag>
        </button>
      )}
      {!shown.length && !canCreate && <p className="px-2 py-1 text-muted">選択肢はまだありません</p>}
      {editing && optionMenu.anchor && (
        <Popover anchor={optionMenu.anchor} onClose={() => (optionMenu.close(), setEditing(null))} width={220} label="選択肢の編集" nested>
          <OptionMenu key={editing} database={database} prop={prop} option={editing} onDone={() => (optionMenu.close(), setEditing(null))} />
        </Popover>
      )}
    </div>
  );
}

function OptionMenu({ database, prop, option, onDone }: { database: Database; prop: Property; option: string; onDone: () => void }) {
  const [name, setName] = useState(option);
  const current = colorOf(prop, option);
  // 選択肢に付ける数（手数料の％など。数式の 数({項目}) で使う）。空にすると外す
  const [num, setNum] = useState(prop.optionValues?.[option] === undefined ? "" : String(prop.optionValues[option]));
  const saveNum = () => {
    const v = num.trim() === "" ? undefined : Number(num);
    if (v !== undefined && !Number.isFinite(v)) return;
    if (v !== prop.optionValues?.[option]) void setOptionValue(database.id, prop.id, option, v);
  };
  return (
    <div>
      <input
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== option && renameOption(database.id, prop.id, option, name.trim())}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            if (name.trim() && name.trim() !== option) void renameOption(database.id, prop.id, option, name.trim());
            onDone();
          }
        }}
        className="field mb-1 py-1"
        aria-label="選択肢の名前"
      />
      <MenuItem
        icon={<Icon name="del" size={16} />}
        danger
        onClick={async () => {
          if (await confirmAction(`選択肢「${option}」を削除します`, "削除", "この選択肢が入っているページは空になります。")) {
            await deleteOption(database.id, prop.id, option);
            onDone();
          }
        }}
      >
        削除
      </MenuItem>
      <label className="flex items-center gap-2 px-2 py-1" title="数式の 数({項目}) で使えます">
        <span className="shrink-0 text-xs text-muted">数</span>
        <input
          type="number"
          step="any"
          value={num}
          onChange={(e) => setNum(e.target.value)}
          onBlur={saveNum}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && saveNum()}
          placeholder="なし"
          className="field min-w-0 py-1"
          aria-label="選択肢に付ける数"
        />
      </label>
      {prop.type === "status" && (
        <>
          <MenuDivider />
          <MenuLabel>グループ</MenuLabel>
          {STATUS_GROUPS.map((g) => (
            <MenuItem key={g.id} active={statusGroupOf(prop, option) === g.id} onClick={() => setOptionGroup(database.id, prop.id, option, g.id)}>
              {g.label}
            </MenuItem>
          ))}
        </>
      )}
      <MenuDivider />
      <MenuLabel>色</MenuLabel>
      {(Object.keys(TAG_COLORS) as TagColor[]).map((c) => (
        <MenuItem
          key={c}
          icon={<span className="h-3.5 w-3.5 rounded-[4px]" style={{ background: TAG_COLORS[c].hue }} />}
          active={c === current}
          onClick={() => setOptionColor(database.id, prop.id, option, c)}
        >
          {TAG_COLORS[c].label}
        </MenuItem>
      ))}
    </div>
  );
}

/** 工程を選ぶ。選べるのは、そのページのプラン（切り替える項目）の工程だけ */
export function StageEditor({
  database,
  prop,
  page,
  onChange,
  onDone,
}: {
  database: Database;
  prop: Property;
  page: Pick<DbPage, "values">;
  onChange: (v: unknown) => void;
  onDone?: () => void;
}) {
  const list = stagesFor(prop, page);
  const base = database.props.find((p) => p.id === prop.basedOn);
  const current = page.values[prop.id];
  if (base && !page.values[base.id]) return <p className="p-2 text-muted">先に「{base.name}」を選んでください。選んだ{base.name}の工程が出ます。</p>;
  if (!list.length) return <p className="p-2 text-muted">工程がまだ決まっていません。列の見出しのメニューの「工程の設定」で作れます。</p>;
  return (
    <div>
      <MenuLabel>{base ? `${base.name}「${String(page.values[base.id])}」の工程` : "工程"}</MenuLabel>
      {list.map((s) => (
        <MenuItem
          key={s.name}
          active={current === s.name}
          right={<span className="text-xs text-muted">{s.pct}%</span>}
          onClick={() => {
            onChange(current === s.name ? "" : s.name);
            onDone?.();
          }}
        >
          {s.name}
        </MenuItem>
      ))}
    </div>
  );
}
