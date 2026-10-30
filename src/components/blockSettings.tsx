"use client";

import { useRef, useState } from "react";
import { PropIcon, PROP_TYPES } from "@/components/db/meta";
import { Icon } from "@/components/Icon";
import { MenuDivider } from "@/components/ui/Popover";
import { BackHead, ChoiceScreen, EmptyNote, NavRow, OptionRow, SearchBox, SectionHead } from "@/components/ui/SettingsMenu";
import type { Database, DbPage, Property } from "@/lib/local/db";
import { useDatabases, usePage, usePages } from "@/lib/local/requests";
import type { MemberWithProfile } from "@/lib/local/rooms";

// ブロックとデータベースのビューの設定で共通に使う、選ぶ画面（ソース・項目・書き込める人・プロパティの表示/非表示）。
// シングルビュー・ページの項目・データベースと繋いだテキスト・チャット・ビューの設定で同じものを使う

/** 「このページ」（ページの本文・テンプレートの中で、そのページ） */
export const THIS_PAGE = "@this";

/** ソースの短い説明（「このページ」「依頼 › 〇〇様」など） */
export function sourceText(thisPage: boolean, canThisPage: boolean, database: Database | null | undefined, page: DbPage | null | undefined) {
  if (thisPage) return canThisPage ? "このページ" : "選んでいません";
  if (!database) return "選んでいません";
  return `${database.name} › ${page ? page.title || "無題" : "ページを選んでいません"}`;
}

/**
 * ソースを選ぶ画面：「このページ」を押すか、データベースを押して、そのページを選ぶ。
 * 選んだら onPick（データベースが変わったかも渡す。変わったら、項目を選び直す）
 */
export function PageSourceScreen({
  roomId,
  canThisPage,
  thisDbId,
  dbId,
  pageId,
  onPick,
  onBack,
}: {
  roomId: string;
  /** データベースのページの本文（とそのテンプレート）の中なので、「このページ」を選べる */
  canThisPage: boolean;
  /** 「このページ」のデータベース */
  thisDbId?: string;
  dbId: string;
  pageId: string;
  onPick: (next: { dbId: string; pageId: string }, dbChanged: boolean) => void;
  onBack: () => void;
}) {
  const [openDb, setOpenDb] = useState<string | null>(null);
  const databases = useDatabases(roomId) ?? [];
  const pages = usePages(openDb ?? undefined) ?? [];
  const thisPage = pageId === THIS_PAGE;
  const current = usePage(thisPage ? "" : pageId);
  const dbNow = thisPage ? (thisDbId ?? "") : dbId;
  const pick = (next: { dbId: string; pageId: string }) => onPick(next, (next.pageId === THIS_PAGE ? (thisDbId ?? "") : next.dbId) !== dbNow);

  // データベースを押したあと：そのデータベースのページ（新しい順）から選ぶ
  if (openDb) {
    const d = databases.find((x) => x.id === openDb);
    return (
      <ChoiceScreen
        title={d?.name ?? "ページ"}
        search="ページを検索"
        section="ページを選ぶ"
        empty="ページがありません"
        items={[...pages].sort((a, b) => b.createdAt - a.createdAt).map((p) => ({ id: p.id, label: p.title || "無題", icon: "note" as const, emoji: p.icon }))}
        selected={!thisPage && dbId === openDb ? pageId : ""}
        onPick={(id) => pick({ dbId: openDb, pageId: id })}
        onBack={() => setOpenDb(null)}
      />
    );
  }
  return (
    <div>
      <BackHead title="ソース" onBack={onBack} />
      {canThisPage && (
        <OptionRow icon="note" selected={thisPage} onClick={() => pick({ dbId: "", pageId: THIS_PAGE })} note="このブロックを置いているページ">
          このページ
        </OptionRow>
      )}
      <SectionHead label={canThisPage ? "ほかのページ" : "データベースを押して、ページを選ぶ"} />
      {databases.map((d) => (
        <NavRow key={d.id} icon="db" emoji={d.icon} label={d.name || "無題"} value={!thisPage && dbId === d.id && current ? current.title || "無題" : ""} onClick={() => setOpenDb(d.id)} />
      ))}
      {!databases.length && <EmptyNote>データベースがありません</EmptyNote>}
    </div>
  );
}

/** 項目を選ぶ画面 */
export function PropScreen({ props, selected, onPick, onBack }: { props: Property[]; selected: string; onPick: (id: string) => void; onBack: () => void }) {
  return (
    <ChoiceScreen
      title="項目"
      search="項目を検索"
      empty="項目がありません"
      items={props.map((p) => ({ id: p.id, label: p.name, icon: PROP_TYPES[p.type].icon }))}
      selected={selected}
      onPick={onPick}
      onBack={onBack}
    />
  );
}

/** 書き込める人の短い説明（選んでいなければ「全員」） */
export function writersText(members: MemberWithProfile[], allowed: string[] | undefined) {
  if (!allowed?.length) return "全員";
  return allowed.map((id) => members.find((m) => m.userId === id)?.displayName ?? "退出した人").join("・");
}

/** 書き込める人を選ぶ画面（何人でも選べる。選ばなければ全員） */
export function WritersScreen({
  members,
  allowed,
  onChange,
  onBack,
}: {
  members: MemberWithProfile[];
  allowed: string[];
  onChange: (next: string[] | undefined) => void;
  onBack: () => void;
}) {
  return (
    <div>
      <BackHead title="書き込める人" onBack={onBack} />
      <OptionRow icon="ppl" selected={!allowed.length} onClick={() => onChange(undefined)}>
        全員
      </OptionRow>
      <SectionHead label="選んだ人だけ（何人でも）" />
      {members.map((m) => {
        const on = allowed.includes(m.userId);
        return (
          <OptionRow
            key={m.userId}
            icon="person"
            selected={on}
            onClick={() => {
              const next = on ? allowed.filter((x) => x !== m.userId) : [...allowed, m.userId];
              onChange(next.length ? next : undefined);
            }}
          >
            {m.displayName}
          </OptionRow>
        );
      })}
    </div>
  );
}

/**
 * プロパティの表示/非表示（Notion のビューの設定と同じ）。ページの項目ブロックと、データベースのビューの設定で使う。
 * 表示中の項目は「⋮⋮」をドラッグして並べ替え、目のボタンで隠す。隠している項目は目のボタンで出す。
 * all は出せる項目、shown は今出している項目（並べた順）。変えたら、出す項目の ID の並びを onSave に渡す
 */
export function PropVisibilityScreen<P extends { id: string; name: string }>({
  all,
  shown,
  onSave,
  onBack,
  onAdd,
  icon = (p) => <PropIcon type={(p as unknown as Property).type} />,
  noun = "プロパティ",
}: {
  all: P[];
  shown: P[];
  onSave: (ids: string[]) => void;
  onBack: () => void;
  /** 「項目を追加」の画面に進む（データベースのビューの設定） */
  onAdd?: () => void;
  /** 項目の左のアイコン。データベースの項目でないもの（メディアのリストの列など）で使う */
  icon?: (p: P) => React.ReactNode;
  /** 画面の言葉（「〇〇の表示/非表示」「表示中の〇〇」）。メディアのリストでは「詳細」 */
  noun?: string;
}) {
  const [q, setQ] = useState("");
  const ids = shown.map((p) => p.id);
  const hidden = all.filter((p) => !ids.includes(p.id));
  const query = q.trim().toLowerCase();
  const match = (p: P) => !query || p.name.toLowerCase().includes(query);
  const save = onSave;

  // ドラッグ中の項目と、落とす位置（何番目の前か）。指を離すときは最新の値を ref から読む
  const list = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; to: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  const putDrag = (d: { id: string; to: number } | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const indexAt = (y: number) =>
    [...(list.current?.querySelectorAll<HTMLElement>("[data-prop-row]") ?? [])].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2 < y;
    }).length;
  const drop = () => {
    const d = dragRef.current;
    putDrag(null);
    if (!d) return;
    const from = ids.indexOf(d.id);
    const to = d.to > from ? d.to - 1 : d.to;
    if (from < 0 || to === from) return;
    const next = ids.filter((x) => x !== d.id);
    next.splice(to, 0, d.id);
    save(next);
  };

  return (
    <div>
      <BackHead title={`${noun}の表示/非表示`} onBack={onBack} />
      <SearchBox value={q} onChange={setQ} placeholder={`${noun}を検索`} />

      <SectionHead label={`表示中の${noun}`} action={shown.length ? { label: "すべて非表示", onClick: () => save([]) } : undefined} />
      <div ref={list}>
        {shown.filter(match).map((p, i, rows) => (
          <div key={p.id} data-prop-row="" className={`relative flex h-8 items-center gap-1.5 rounded-[8px] px-1 hover:bg-tint ${drag?.id === p.id ? "opacity-40" : ""}`}>
            {/* 落とす位置の線 */}
            {drag?.to === i && <span aria-hidden className="absolute inset-x-1 -top-px h-0.5 rounded-full bg-accent" />}
            {drag?.to === rows.length && i === rows.length - 1 && <span aria-hidden className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent" />}
            {query ? (
              // 検索で絞っているあいだは並べ替えない
              <span className="w-4 shrink-0" />
            ) : (
              <span
                aria-label={`「${p.name}」をドラッグして並べ替え`}
                title="ドラッグして並べ替え"
                className="grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center text-muted active:cursor-grabbing"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  putDrag({ id: p.id, to: i });
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d || d.id !== p.id) return;
                  const to = indexAt(e.clientY);
                  if (to !== d.to) putDrag({ id: p.id, to });
                }}
                onPointerUp={drop}
                onPointerCancel={() => putDrag(null)}
              >
                <Icon name="drag" size={14} />
              </span>
            )}
            {icon(p)}
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <button onClick={() => save(ids.filter((x) => x !== p.id))} aria-label={`「${p.name}」を隠す`} title="隠す" className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-bg">
              <Icon name="eye" size={14} />
            </button>
          </div>
        ))}
        {!shown.length && <p className="px-2 py-1 text-xs text-muted">ありません</p>}
      </div>

      <SectionHead label={`非表示の${noun}`} action={hidden.length ? { label: "すべて表示", onClick: () => save([...ids, ...hidden.map((p) => p.id)]) } : undefined} />
      {hidden.filter(match).map((p) => (
        <div key={p.id} className="flex h-8 items-center gap-1.5 rounded-[8px] px-1 text-muted hover:bg-tint">
          <span className="w-4 shrink-0" />
          {icon(p)}
          <span className="min-w-0 flex-1 truncate">{p.name}</span>
          <button onClick={() => save([...ids, p.id])} aria-label={`「${p.name}」を表示`} title="表示する" className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-bg hover:text-ink">
            <Icon name="eyeoff" size={14} />
          </button>
        </div>
      ))}
      {!hidden.length && <p className="px-2 py-1 text-xs text-muted">ありません</p>}
      {onAdd && (
        <>
          <MenuDivider />
          <NavRow icon="add" label="項目を追加" onClick={onAdd} />
        </>
      )}
    </div>
  );
}
