"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChatImagesButton } from "@/components/chat/ChatImages";
import { ChatSearchButton } from "@/components/chat/ChatSearch";
import { ChatView } from "@/components/chat/ChatView";
import { ImageChatView } from "@/components/chat/ImageChatView";
import { PropInput } from "@/components/db/PropInput";
import { PropValue } from "@/components/db/values";
import { Gauge } from "@/components/db/views/common";
import { PageSourceScreen, PropScreen, PropVisibilityScreen, sourceText, THIS_PAGE, WritersScreen, writersText } from "@/components/blockSettings";
import { SettingsButton, useNoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { DEFAULT_PAGE_ICON, IconMark, mediaIconId } from "@/components/IconMark";
import { IconPicker } from "@/components/IconPicker";
import { MenuDivider, MenuItem, Popover, usePopover } from "@/components/ui/Popover";
import { BackHead, ChoiceScreen, EmptyNote, MenuTitle, NavRow, OptionRow, SectionHead, TextField, ToggleRow } from "@/components/ui/SettingsMenu";
import { choose } from "@/components/ui/overlay";
import { useChat } from "@/lib/local/chat";
import type { Database, DbPage, ImageUser, Profile, Property } from "@/lib/local/db";
import { addProperty, ensurePropChat, setPageIcon, showPropInTables, updatePageTitle, updatePageValue, updateProperty, useDatabase, usePage } from "@/lib/local/requests";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { P } from "@/lib/requests/defaults";
import { dueLabel, stagesOf, today, valueOf } from "@/lib/requests/logic";
import { stageDates, stageOf } from "@/lib/requests/stages";

// データベースのページの中で使うブロック（そのページのタイトル・項目・チャット）。
// ページの本文（ウィンドウ・ノート）と、そのテンプレートで使う。テンプレートではページがまだ無いので、見本を出す

/** ページの外（ふつうのノートやウィンドウ）や、テンプレートのときの表示 */
function Placeholder({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full min-h-12 place-items-center rounded-[10px] border border-dashed border-line p-3 text-center text-sm text-muted">{children}</div>;
}

/** 今のページと、そのデータベース */
function usePageScope() {
  const ctx = useNoteContext();
  const database = useDatabase(ctx.page?.dbId ?? "");
  const page = usePage(ctx.page?.pageId ?? "");
  return { ctx, database, page };
}

// ---- タイトル ----

/** アイコンと名前（後ろに「様の依頼」のような言葉を付けられる） */
export function PageTitleView({ database, page, suffix }: { database: Database; page: DbPage; suffix: string }) {
  const iconPop = usePopover();
  return (
    <div data-name="ページの名前" className="flex min-w-0 flex-wrap items-center gap-2">
      <button onClick={iconPop.toggle} aria-label="アイコンを変える" title="アイコンを変える" className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-[26px] hover:bg-tint">
        <IconMark icon={page.icon || DEFAULT_PAGE_ICON} size={30} />
      </button>
      {iconPop.anchor && <IconPicker anchor={iconPop.anchor} roomId={database.roomId} hasIcon={!!page.icon} onPick={(i) => void setPageIcon(page.id, i)} onClose={iconPop.close} />}
      <TitleInput key={page.id} value={page.title} onSave={(t) => updatePageTitle(page.id, t)} suffix={suffix} placeholder={database.props.find((p) => p.type === "title")?.name ?? "無題"} />
    </div>
  );
}

function PageTitleBlock({ suffix, onChange }: { suffix: string; onChange: (p: Record<string, string>) => void }) {
  const { ctx, database, page } = usePageScope();
  const setting = !ctx.locked && (
    <label className="mt-1 flex items-center gap-1 text-xs text-muted">
      名前の後ろに付ける言葉
      <input defaultValue={suffix} onBlur={(e) => e.target.value !== suffix && onChange({ suffix: e.target.value })} placeholder="例：様の依頼" className="field w-32 py-0.5" />
    </label>
  );
  if (!ctx.page) return <Placeholder>ページのタイトル（データベースのページの中で使えます）</Placeholder>;
  if (!page || !database)
    return (
      <div className="px-3 py-2">
        <p className="text-[26px] font-bold text-muted">
          （ページの名前）<span className="text-lg">{suffix}</span>
        </p>
        {setting}
      </div>
    );
  return (
    <div className="px-3 py-2">
      <PageTitleView database={database} page={page} suffix={suffix} />
      {setting}
    </div>
  );
}

function TitleInput({ value, onSave, suffix, placeholder }: { value: string; onSave: (v: string) => void; suffix: string; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-1">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => (draft.trim() && draft !== value ? onSave(draft.trim()) : setDraft(value))}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
        aria-label="名前"
        placeholder={placeholder}
        className="max-w-full min-w-[4em] rounded-[8px] bg-transparent text-[1.8em] font-bold outline-none [field-sizing:content] hover:bg-tint focus:bg-tint"
        // 入力欄の幅を、中の文字の長さぴったりにする
      />
      {suffix && <span className="shrink-0 font-bold text-muted">{suffix}</span>}
    </div>
  );
}

// ---- 進み具合と工程・納期 ----

/** 進み具合のゲージ、工程の期限、納期まで、状態 */
export function PageProgressView({ database, page }: { database: Database; page: DbPage }) {
  const stageProp = database.props.find((p) => p.type === "stage");
  const stageNow = stageProp ? stageOf(stageProp, page) : null;
  const progress = stageNow ? stageNow.pct : Number(valueOf(page, P.progress)) || 0;
  const due = dueLabel(valueOf(page, P.due));
  const stages = stageProp
    ? stageDatesOf(stageProp, page)
    : database.kind === "request"
      ? stagesOf(database, page).map((x) => ({ name: x.name, date: x.date, pct: 0, done: x.date < today() }))
      : [];
  return (
    <div data-name="進行と納期" className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <div className="flex min-w-48 flex-1 items-center gap-2">
          <Gauge value={progress} />
          <button
            className="shrink-0 rounded-full px-2 font-bold hover:bg-tint"
            title={stageProp ? "工程を選ぶ" : "進行を変える"}
            onClick={async () => {
              if (stageProp && stageNow) {
                if (!stageNow.list.length) return;
                const i = await choose(
                  stageProp.name,
                  stageNow.list.map((x) => ({ label: `${x.name}（${x.pct}%）${x.pct >= 100 ? "　完了にする" : ""}` })),
                );
                if (i !== null) updatePageValue(page.id, stageProp.id, stageNow.list[i].name);
                return;
              }
              const steps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
              const i = await choose("進行（%）", steps.map((n) => ({ label: `${n}%${n === 100 ? "（完了にする）" : ""}` })));
              if (i !== null) updatePageValue(page.id, P.progress, steps[i]);
            }}
          >
            {stageNow?.current ? `${stageNow.current.name}・` : ""}
            {progress}%
          </button>
        </div>
        {due && <span className={due.tone === "late" ? "font-bold text-warn" : due.tone === "soon" ? "font-bold" : "text-muted"}>納期まで {due.text}</span>}
        {typeof page.values[P.status] === "string" && <span className="rounded-full bg-tint px-2 text-xs">{String(page.values[P.status])}</span>}
      </div>
      <StagePills stages={stages} onPick={stageProp ? (name) => updatePageValue(page.id, stageProp.id, name) : undefined} />
    </div>
  );
}

/** 工程ごとの期限を並べる。onPick があれば、押すとその工程まで進める。日付が無い工程は名前だけ出す */
export function StagePills({ stages, onPick }: { stages: { name: string; date: string; done: boolean }[]; onPick?: (name: string) => void }) {
  const now = today();
  if (!stages.length) return null;
  return (
    <ol data-name="工程の期限" className="flex gap-1 overflow-x-auto pb-1 text-xs" aria-label="工程の期限">
      {stages.map((s) => (
        <li key={s.name + s.date} className="shrink-0">
          <button
            disabled={!onPick}
            title={onPick ? `「${s.name}」まで進める` : undefined}
            onClick={() => onPick?.(s.name)}
            className={`rounded-full border px-2 py-0.5 ${
              s.done ? "border-accent bg-accent text-accent-ink" : !s.date ? "border-line" : s.date < now ? "border-warn text-warn" : s.date === now ? "border-warn font-bold" : "border-line"
            } ${onPick ? "hover:opacity-80" : ""}`}
          >
            {s.name}
            {s.date && ` ${Number(s.date.slice(5, 7))}/${Number(s.date.slice(8))}`}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * 工程の項目の、ページの工程の期限（工程の設定の開始日から終了日までを、工程の割合で分けた日）。
 * 開始日か終了日が空のときは日付を出せないので、工程の名前と終わったかだけ（date が ""）
 */
export function stageDatesOf(prop: Property, page: DbPage): { name: string; pct: number; date: string; done: boolean }[] {
  const dated = stageDates(prop, page);
  if (dated.length) return dated;
  const { list, index } = stageOf(prop, page);
  return list.map((x, i) => ({ name: x.name, pct: x.pct, date: "", done: i <= index }));
}

/** 工程の今の段階と％のボタン（押すと工程を選んで進める） */
export function StageButton({ prop, page }: { prop: Property; page: DbPage }) {
  const now = stageOf(prop, page);
  return (
    <button
      className="shrink-0 rounded-full px-2 font-bold hover:bg-tint"
      title="工程を選ぶ"
      onClick={async () => {
        if (!now.list.length) return;
        const i = await choose(
          prop.name,
          now.list.map((x) => ({ label: `${x.name}（${x.pct}%）${x.pct >= 100 ? "　完了にする" : ""}` })),
        );
        if (i !== null) updatePageValue(page.id, prop.id, now.list[i].name);
      }}
    >
      {now.current ? `${now.current.name}・` : ""}
      {now.pct}%
    </button>
  );
}


// ---- 項目 ----

/** ページの項目ブロックに出せる項目（タイトルとチャットの項目は除く。チャットはシングルビューで出す） */
export const listableProps = (database: Database) => database.props.filter((p) => p.type !== "title" && p.type !== "chat" && p.type !== "imageChat");

/** 出す項目の ID の並び（JSON）を読む。決めていなければ null（全部出す） */
function parseIds(s: string | undefined): string[] | null {
  if (!s) return null;
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/** ページの項目ブロックが出す項目（並べた順）。決めていなければ全部 */
export function shownProps(database: Database, visible: string | undefined): Property[] {
  const all = listableProps(database);
  const ids = parseIds(visible);
  if (!ids) return all;
  return ids.map((id) => all.find((p) => p.id === id)).filter((p): p is Property => !!p);
}

/** ページの項目を並べて入力する（依頼の詳細など）。props を渡すとその項目だけ、渡さなければ全部 */
export function PagePropsView({
  database,
  page,
  members,
  userId,
  props,
  className = "space-y-3",
}: {
  database: Database;
  page: DbPage;
  members: MemberWithProfile[];
  userId: string;
  props?: Property[];
  className?: string;
}) {
  // 同じページの項目を2か所に出しても、名前を押したときに正しい入力欄に移るようにする
  const uid = useId();
  return (
    <div className={className}>
      {(props ?? listableProps(database)).map((p) => (
        <label key={p.id} className="block" htmlFor={`${uid}-${p.id}`}>
          <span className="text-xs text-muted">{p.name}</span>
          <PropInput
            id={`${uid}-${p.id}`}
            database={database}
            prop={p}
            value={page.values[p.id]}
            onChange={(v) => updatePageValue(page.id, p.id, v)}
            members={members}
            userId={userId}
            page={page}
          />
        </label>
      ))}
    </div>
  );
}

/** ページの項目ブロックの props（ブロックの props と同じ）。visible は出す項目の ID の並び（JSON。空なら全部） */
type PagePropsProps = { heading?: string; dbId?: string; pageId?: string; visible?: string };

/** ブロックが出すページ（「このページ」か、選んだデータベースのページ）と、そのデータベース。undefined は読み込み中、null は見つからない */
function usePropsSource(props: PagePropsProps) {
  const ctx = useNoteContext();
  const thisPage = (props.pageId ?? THIS_PAGE) === THIS_PAGE;
  const database = useDatabase(thisPage ? (ctx.page?.dbId ?? "") : (props.dbId ?? ""));
  const page = usePage(thisPage ? (ctx.page?.pageId ?? "") : (props.pageId ?? ""));
  return { ctx, thisPage, database, page };
}

/**
 * ページの項目：ページの項目を並べて、その場で入力できる（依頼の詳細など）。
 * 歯車の設定で、ソース（このページ・ほかのページ）と、出す項目と順番（プロパティの表示/非表示）を選ぶ
 */
function PagePropsBlock({ props, onChange }: { props: PagePropsProps; onChange: (p: Record<string, string>) => void }) {
  const { ctx, thisPage, database, page } = usePropsSource(props);
  const heading = props.heading ?? "";
  const shown = database ? shownProps(database, props.visible) : [];
  // ソースが決まっていない：「このページ」なのにデータベースのページの中ではない、またはほかのページを選んでいない
  const noSource = thisPage ? !ctx.page : !props.dbId || !props.pageId;
  const settings = !ctx.locked && (
    <SettingsButton label="ページの項目の設定">
      <PagePropsMenu props={props} onChange={onChange} />
    </SettingsButton>
  );
  // ほかのページを出しているときは、どのページかを見出しの横に出す（押すとそのページを開く）
  const sourceLink = !thisPage && database && page && (
    <Link href={`/r/${ctx.roomId}/db/${database.id}/p/${page.id}`} className="min-w-0 truncate text-xs text-muted hover:underline" title="このページを開く">
      {database.name} › {page.title || "無題"}
    </Link>
  );
  const note = (text: string) => <p className="pr-6 text-sm text-muted">{text}</p>;

  let body: React.ReactNode;
  if (noSource) body = note(ctx.locked ? "編集モードで、どのページの項目を出すか選んでください" : "歯車の「ソース」で、どのページの項目を出すか選んでください");
  else if (database === undefined || page === undefined) body = note("読み込み中…");
  else if (!database) body = note("データベースが見つかりません。歯車の「ソース」で選び直してください");
  else if (!shown.length) body = note(ctx.locked ? "出す項目がありません" : "出す項目がありません（歯車の「プロパティの表示/非表示」で選べます）");
  else if (page) body = <PagePropsView database={database} page={page} members={ctx.members} userId={ctx.userId} props={shown} />;
  else if (thisPage && ctx.template)
    // テンプレート：ページがまだ無いので、入力欄の形だけ見せる
    body = (
      <div className="space-y-3">
        {shown.map((p) => (
          <div key={p.id}>
            <span className="text-xs text-muted">{p.name}</span>
            <div className="field truncate text-muted">（ページの値）</div>
          </div>
        ))}
      </div>
    );
  else body = note("ページが見つかりません。歯車の「ソース」で選び直してください");

  const headed = !!(heading || sourceLink);
  return (
    <div className="relative p-3" data-name="ページの項目">
      {(headed || settings) && (
        // 見出しが無いときは、歯車を右上に重ねて、上に余白を作らない（歯車は同じ場所に置いたままにして、開いた設定が閉じないようにする）
        // data-block-head / data-block-title：タブの中では見出し（タブの名前と同じ）を出さない
        <div className={headed ? "mb-2 flex min-w-0 items-center gap-2" : "absolute top-1 right-1 z-[1] flex"} data-block-head="" data-locked={ctx.locked ? "" : undefined}>
          {heading && (
            <h2 className="min-w-0 truncate font-bold" data-block-title="">
              {heading}
            </h2>
          )}
          {sourceLink}
          {settings}
        </div>
      )}
      {body}
    </div>
  );
}

// ---- ページの項目の設定（Notion のビューの設定と同じく、行を押すと中の画面に進む） ----

/** ページの項目の設定。トップ（見出し・ソース・プロパティの表示/非表示）から、それぞれの画面に進む */
function PagePropsMenu({ props, onChange }: { props: PagePropsProps; onChange: (p: Record<string, string>) => void }) {
  const { ctx, thisPage, database, page } = usePropsSource(props);
  const [screen, setScreen] = useState<"top" | "source" | "props">("top");
  const top = () => setScreen("top");
  const shown = database ? shownProps(database, props.visible) : [];

  if (screen === "source")
    return (
      <PageSourceScreen
        roomId={ctx.roomId}
        canThisPage={!!ctx.page}
        thisDbId={ctx.page?.dbId}
        dbId={props.dbId ?? ""}
        pageId={props.pageId ?? THIS_PAGE}
        // データベースが変わったら、出す項目は全部に戻す（項目はデータベースごとに違う）
        onPick={(next, dbChanged) => {
          onChange({ ...next, ...(dbChanged ? { visible: "" } : {}) });
          top();
        }}
        onBack={top}
      />
    );
  if (screen === "props" && database) return <PropVisibility database={database} visible={props.visible} onChange={(visible) => onChange({ visible })} onBack={top} />;

  return (
    <div>
      <MenuTitle>ページの項目の設定</MenuTitle>
      <TextField label="見出し" defaultValue={props.heading ?? ""} onChange={(heading) => onChange({ heading })} placeholder="なし（例：依頼の詳細）" />
      <MenuDivider />
      <NavRow icon="db" label="ソース" value={sourceText(thisPage, !!ctx.page, database, page)} onClick={() => setScreen("source")} />
      <NavRow icon="eye" label="プロパティの表示/非表示" value={database ? `${shown.length}個を表示` : ""} onClick={() => setScreen("props")} disabled={!database} />
    </div>
  );
}

/** プロパティの表示/非表示（ページの項目）。全部を決まった順で出すときは「決めていない」にしておく（あとでデータベースに足した項目も出る） */
function PropVisibility({ database, visible, onChange, onBack }: { database: Database; visible: string | undefined; onChange: (visible: string) => void; onBack: () => void }) {
  const all = listableProps(database);
  return (
    <PropVisibilityScreen
      all={all}
      shown={shownProps(database, visible)}
      onSave={(next) => onChange(next.length === all.length && next.every((id, i) => id === all[i].id) ? "" : JSON.stringify(next))}
      onBack={onBack}
    />
  );
}

// ---- ページのチャット ----

/** ページに付いているチャット（依頼進行チャット・やり取り再現） */
function PageChatBlock({ which, onChange }: { which: string; onChange: (p: Record<string, string>) => void }) {
  const { ctx, page } = usePageScope();
  const chat = useChat((which === "reenact" ? page?.reenactChatId : page?.chatId) ?? "");
  const me: Profile = { id: ctx.userId, displayName: ctx.members.find((m) => m.userId === ctx.userId)?.displayName ?? "", username: "", createdAt: 0 };
  if (!ctx.page) return <Placeholder>ページのチャット（データベースのページの中で使えます）</Placeholder>;
  return (
    <div className="flex h-full flex-col p-2">
      {!ctx.locked && (
        <div className="mb-1 flex">
          <SettingsButton label="ページのチャットの設定">
            <PageChatMenu which={which} onChange={onChange} />
          </SettingsButton>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {chat ? (
          <ChatView key={chat.id} chat={chat} me={me} members={ctx.members} />
        ) : (
          <Placeholder>{page ? "読み込み中…" : which === "reenact" ? "ページのやり取り再現がここに出ます" : "ページの進行チャットがここに出ます"}</Placeholder>
        )}
      </div>
    </div>
  );
}

const PAGE_CHATS = [
  { id: "main", label: "依頼進行チャット（コメント）", icon: "chat" as const },
  { id: "reenact", label: "やり取り再現", icon: "ppl" as const },
];

/** ページのチャット（前のブロック）の設定：どのチャットを出すか */
function PageChatMenu({ which, onChange }: { which: string; onChange: (p: Record<string, string>) => void }) {
  const [screen, setScreen] = useState<"top" | "which">("top");
  if (screen === "which")
    return (
      <ChoiceScreen
        title="出すチャット"
        items={PAGE_CHATS}
        selected={which}
        onPick={(id) => {
          onChange({ which: id });
          setScreen("top");
        }}
        onBack={() => setScreen("top")}
      />
    );
  return (
    <div>
      <MenuTitle>ページのチャットの設定</MenuTitle>
      <NavRow icon="chat" label="出すチャット" value={PAGE_CHATS.find((c) => c.id === which)?.label} onClick={() => setScreen("which")} />
    </div>
  );
}

/** ページのブロックの中身 */
export function PageBlockBody({ type, props, onChange }: { type: PageKind; props: Record<string, string>; onChange: (p: Record<string, string>) => void }) {
  switch (type) {
    case "pageTitle":
      return <PageTitleBlock suffix={props.suffix ?? ""} onChange={onChange} />;
    case "pageProps":
      return <PagePropsBlock props={props} onChange={onChange} />;
    case "pageChat":
      return <PageChatBlock which={props.which || "main"} onChange={onChange} />;
  }
}

export type PageKind = "pageTitle" | "pageProps" | "pageChat";

// ---- チャットの項目 ----

/** 依頼者（ページの名前）と参加者（書き込める人、選んでいなければルームの全員）を、イメージチャットの話す人にする */
export function seedUsers(roomId: string, page: Pick<DbPage, "title" | "icon"> | null | undefined, members: MemberWithProfile[], allowed?: string[]): ImageUser[] {
  return [
    ...(page ? [{ id: "@page", roomId, name: page.title || "依頼者", ...(mediaIconId(page.icon) ? { mediaId: mediaIconId(page.icon) } : { icon: page.icon }), createdAt: 0 }] : []),
    ...members.filter((m) => !allowed?.length || allowed.includes(m.userId)).map((m) => ({ id: `@user:${m.userId}`, roomId, name: m.displayName, createdAt: 0 })),
  ];
}

/** ページのチャットの項目のチャット（無ければ作る）。チャットの項目はイメージチャットなら、話す人に依頼者と参加者を入れられる */
export function PropChatView({ database, page, prop }: { database: Database; page: DbPage; prop: Property }) {
  const ctx = useNoteContext();
  const cur = page.values[prop.id];
  const chatId = typeof cur === "string" ? cur : "";
  const chat = useChat(chatId);
  useEffect(() => {
    if (!chatId || chat === null) void ensurePropChat(page.id, prop);
  }, [chatId, chat, page.id, prop]);
  if (!chat) return <p className="text-sm text-muted">準備中…</p>;
  const me: Profile = { id: ctx.userId, displayName: ctx.members.find((m) => m.userId === ctx.userId)?.displayName ?? "", username: "", createdAt: 0 };
  const canTalk = !prop.allowed?.length || prop.allowed.includes(ctx.userId);
  const notice = canTalk ? undefined : `「${prop.name}」に書き込めるのは、選ばれた人だけです`;
  void database;
  if (chat.kind === "image") {
    return <ImageChatView key={chat.id} chat={chat} me={me} readOnlyNotice={notice} fixedUsers={prop.seed === "page" ? seedUsers(page.roomId, page, ctx.members, prop.allowed) : []} />;
  }
  return <ChatView key={chat.id} chat={chat} me={me} members={ctx.members} readOnlyNotice={notice} />;
}

// ---- データベースのページの中のチャット・イメージチャットのブロック ----

/**
 * データベースのページ（とそのテンプレート・メモ）に置いたチャット・イメージチャットのブロック：データベースのチャットの項目と繋ぐ。
 * 会話はページごとに、その項目に入る（表やシングルビューからも同じ会話が見られる）。
 * 繋ぐ項目がまだ無ければ、データベースにチャットの項目を足して繋ぐ。繋ぐ項目は歯車から選び直せる
 */
export function DbChatBlock({ kind, propId, onChange, fill }: { kind: "normal" | "image"; propId: string; onChange: (p: Record<string, string>) => void; fill?: boolean }) {
  const ctx = useNoteContext();
  const database = useDatabase(ctx.page?.dbId ?? "");
  const page = usePage(ctx.page?.pageId ?? "");
  const type = kind === "image" ? "imageChat" : "chat";
  const linked = database?.props.find((p) => p.id === propId && p.type === type);
  // 繋ぐ項目が決まっていなければ、同じ種類の1つ目の項目と繋ぐ（無ければ足す）。ほかの項目は歯車から選び直せる
  const fallback = !linked ? database?.props.find((p) => p.type === type) : undefined;
  const prop = linked ?? fallback;
  const base = kind === "image" ? "イメージチャット" : "チャット";
  const creating = useRef(false);
  useEffect(() => {
    // 読むだけのときは、ブロックを書き換えない（1つ目の項目を出すだけ）
    if (!database || linked || creating.current || ctx.locked) return;
    creating.current = true;
    // 繋いだ項目（作った項目も）は、データベースの表に列として出す
    const link = (propId: string) => {
      onChange({ propId });
      void showPropInTables(database.id, propId);
    };
    if (fallback) return link(fallback.id);
    void addProperty(database.id, base, type).then((created) => link(created.id));
  }, [database, linked, fallback, ctx.locked, base, type, onChange]);
  const label = prop?.name ?? base;
  // そのページのチャット（送られた画像のボタンに使う）
  const chatValue = page && prop ? page.values[prop.id] : undefined;
  const chatId = typeof chatValue === "string" ? chatValue : "";

  return (
    <div
      className={`w-full overflow-hidden rounded-[14px] border border-line bg-card ${fill ? "flex h-full flex-col" : ""}`}
      data-fill={fill ? "" : undefined}
      contentEditable={false}
      data-name={`${base}ブロック（データベースの項目）`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-sm" data-block-head="" data-locked={ctx.locked ? "" : undefined}>
        <span className="flex items-center gap-2" data-block-title="">
          <Icon name={kind === "image" ? "ppl" : "chat"} size={16} className="text-muted" />
          <b>{label}</b>
        </span>
        {database && prop && <span className="text-xs text-muted">「{database.name}」の項目</span>}
        {prop?.allowed?.length ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted" title="書き込める人">
            <Icon name="person" size={14} className="shrink-0" />
            <span className="truncate">{writersText(ctx.members, prop.allowed)}</span>
          </span>
        ) : null}
        {/* 右上：送られた画像（チャットのチャンネルと同じ）と、設定の歯車 */}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {chatId && <ChatSearchButton chatId={chatId} roomId={ctx.roomId} compact />}
          {chatId && <ChatImagesButton chatId={chatId} roomId={ctx.roomId} compact />}
          {!ctx.locked && database && (
            <SettingsButton label={`${label}の設定`}>
              <DbChatMenu
              database={database}
              kind={kind}
              prop={prop}
              // 繋いだ項目（作った項目も）は、データベースの表に列として出す
              onPick={(id) => {
                onChange({ propId: id });
                void showPropInTables(database.id, id);
              }}
            />
            </SettingsButton>
          )}
        </span>
      </div>
      <div className={fill ? "min-h-0 flex-1 p-3" : "h-[420px] p-3"}>
        {page && database && prop ? (
          <PropChatView key={prop.id} database={database} page={page} prop={prop} />
        ) : (
          <p className="text-sm text-muted">
            {!prop ? (ctx.locked ? `編集モードにすると、データベースに「${base}」の項目ができて、ここと繋がります` : "準備中…") : `ページを作ると、ここにそのページの「${prop.name}」が出ます`}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * データベースのチャットのブロックの設定：繋いでいる項目（1つのデータベースに1つだけなので、選び直しはない）・書き込める人・
 * （イメージチャットは）依頼者と参加者を話す人に入れるか
 */
function DbChatMenu({ database, kind, prop, onPick }: { database: Database; kind: "normal" | "image"; prop: Property | undefined; onPick: (propId: string) => void }) {
  const { members } = useNoteContext();
  const [screen, setScreen] = useState<"top" | "prop" | "writers">("top");
  const type = kind === "image" ? "imageChat" : "chat";
  const base = kind === "image" ? "イメージチャット" : "チャット";
  const title = `${base}の設定`;
  if (screen === "prop") {
    const props = database.props.filter((p) => p.type === type);
    // 上にデータベースの項目（選ぶと繋ぐ）、仕切りの下に新しく作る操作
    return (
      <div>
        <BackHead title="繋ぐ項目" onBack={() => setScreen("top")} />
        <SectionHead label={`「${database.name}」の項目`} />
        {props.map((p) => (
          <OptionRow
            key={p.id}
            icon={kind === "image" ? "ppl" : "chat"}
            selected={p.id === prop?.id}
            onClick={() => {
              setScreen("top");
              onPick(p.id);
            }}
          >
            {p.name}
          </OptionRow>
        ))}
        {!props.length && <EmptyNote>{base}の項目はまだありません</EmptyNote>}
        <MenuDivider />
        <SectionHead label="新しく作る" />
        <MenuItem
          icon={<Icon name="add" size={16} />}
          onClick={async () => {
            setScreen("top");
            // 名前が重ならないように、後ろに番号を付ける
            const names = new Set(database.props.map((p) => p.name));
            let name = base;
            for (let i = 2; names.has(name); i++) name = `${base}${i}`;
            onPick((await addProperty(database.id, name, type)).id);
          }}
        >
          新しい{base}の項目を作る
        </MenuItem>
      </div>
    );
  }
  if (screen === "writers" && prop)
    return <WritersScreen members={members} allowed={prop.allowed ?? []} onChange={(allowed) => void updateProperty(database.id, prop.id, { allowed })} onBack={() => setScreen("top")} />;
  return (
    <div>
      <MenuTitle>{title}</MenuTitle>
      <NavRow icon="db" label="繋ぐ項目" value={prop ? prop.name : "準備中"} onClick={() => setScreen("prop")} />
      <NavRow icon="person" label="書き込める人" value={prop ? writersText(members, prop.allowed) : "項目ができてから選べます"} onClick={() => setScreen("writers")} disabled={!prop} />
      {kind === "image" && prop && (
        <ToggleRow
          icon="ppl"
          label="依頼者と参加者を話す人に入れる"
          note="ページの名前（依頼者）と書き込める人を、最初から話す人にします"
          on={prop.seed === "page"}
          onChange={(on) => void updateProperty(database.id, prop.id, { seed: on ? "page" : undefined })}
        />
      )}
      <p className="px-2 pt-1 text-xs text-muted">
        会話はページごとに、データベースのこの項目に入ります。項目の名前は、データベースの列の見出しから変えられます。
      </p>
    </div>
  );
}

// ---- データベースと繋いだテキスト ----

/** icon："1" で、前にページのアイコンを出す */
export type FieldProps = { level: string; dbId: string; pageId: string; propId: string; suffix: string; icon: string };

// 見出しの大きさは、ノートの見出し（1.8・1.45・1.2倍）と同じ
// 見出し1は標準の値なので data-level が付かず、ふつうの見出し1は BlockNote の 3em で出る。それに合わせる
const LEVEL_CLASS: Record<string, string> = { "0": "text-[1em]", "1": "text-[3em] font-bold leading-tight", "2": "text-[1.45em] font-bold leading-snug", "3": "text-[1.2em] font-bold" };
const LEVEL_LABEL: Record<string, string> = { "0": "本文", "1": "見出し1", "2": "見出し2", "3": "見出し3" };
/** 文字で直せる項目（それ以外は値を出すだけ） */
const TYPABLE = new Set(["title", "text", "url", "email", "phone"]);

/**
 * データベースの項目と繋いだテキスト。ふつうの段落・見出しの「⋮⋮」から「データベースと繋ぐ」で作る。
 * 項目の値を表示して、その場で直すと項目が変わる（例：見出しをページのタイトルと繋いで「〇〇様の依頼」）
 */
export function FieldBlockView({ props, onChange, onUnbind }: { props: FieldProps; onChange: (p: Partial<FieldProps>) => void; onUnbind: (text: string) => void }) {
  const ctx = useNoteContext();
  const thisPage = props.pageId === "@this";
  const database = useDatabase(thisPage ? (ctx.page?.dbId ?? "") : props.dbId);
  const page = usePage(thisPage ? (ctx.page?.pageId ?? "") : props.pageId);
  const prop = database?.props.find((p) => p.id === props.propId);
  const settings = usePopover();
  const iconPop = usePopover();
  const text = page && prop ? (prop.type === "title" ? page.title : String(valueOf(page, prop.id) ?? "")) : "";
  const save = (v: string) => {
    if (!page || !prop) return;
    if (prop.type === "title") void updatePageTitle(page.id, v);
    else void updatePageValue(page.id, prop.id, v);
  };

  return (
    <div className="group/field relative w-full" contentEditable={false} data-name="データベースと繋いだテキスト">
      <div className={`flex min-w-0 flex-wrap items-baseline gap-1 ${LEVEL_CLASS[props.level] ?? LEVEL_CLASS["0"]}`}>
        {/* ページのアイコン（設定で出すとき）。編集できるときは、押すと変えられる */}
        {props.icon === "1" &&
          page &&
          (ctx.locked ? (
            <span className="shrink-0 self-center leading-none">
              <IconMark icon={page.icon || DEFAULT_PAGE_ICON} />
            </span>
          ) : (
            <button onClick={iconPop.toggle} className="shrink-0 self-center rounded-[6px] leading-none hover:bg-tint" aria-label="ページのアイコンを変える" title="ページのアイコンを変える">
              <IconMark icon={page.icon || DEFAULT_PAGE_ICON} />
            </button>
          ))}
        {page && prop && TYPABLE.has(prop.type) ? (
          <FieldInput key={`${page.id}:${prop.id}`} value={text} onSave={save} placeholder={prop.name} />
        ) : page && prop ? (
          <PropValue prop={prop} value={valueOf(page, prop.id)} members={ctx.members} page={page} empty={<span className="text-muted">（{prop.name}）</span>} />
        ) : (
          <span className="text-muted">{prop ? `（${prop.name}）` : "（データベースの項目を選んでください）"}</span>
        )}
        {props.suffix && <span className="shrink-0 text-[0.65em] font-bold text-muted">{props.suffix}</span>}
      </div>
      {!ctx.locked && (
        <button
          onClick={settings.toggle}
          className="absolute top-0 right-0 flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs text-muted shadow-sm ring-1 ring-line hover:text-ink md:opacity-0 md:group-hover/field:opacity-100"
          title="繋いでいる項目を変える"
        >
          <Icon name="link" size={12} />
          {database && prop ? `${thisPage ? "このページ" : database.name} › ${prop.name}` : "繋ぎ先を選ぶ"}
        </button>
      )}
      {iconPop.anchor && page && (
        <IconPicker anchor={iconPop.anchor} roomId={page.roomId} hasIcon={!!page.icon} onPick={(i) => void setPageIcon(page.id, i)} onClose={iconPop.close} />
      )}
      {settings.anchor && (
        <Popover anchor={settings.anchor} onClose={settings.close} width={300} align="end" label="データベースと繋いだテキストの設定">
          <FieldMenu
            props={props}
            database={database}
            page={page}
            onChange={onChange}
            onUnbind={() => {
              settings.close();
              onUnbind(text);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

/** 文字の大きさを選ぶ画面の見本（実際の大きさに近づける） */
const LEVEL_PREVIEW: Record<string, string> = { "0": "", "1": "text-[1.35em] font-bold", "2": "text-[1.15em] font-bold", "3": "font-bold" };

/** データベースと繋いだテキストの設定：ソース・項目・文字の大きさ・アイコンを出すか・後ろに付ける言葉・繋ぎを外す */
function FieldMenu({
  props,
  database,
  page,
  onChange,
  onUnbind,
}: {
  props: FieldProps;
  database: Database | null | undefined;
  page: DbPage | null | undefined;
  onChange: (p: Partial<FieldProps>) => void;
  onUnbind: () => void;
}) {
  const ctx = useNoteContext();
  const [screen, setScreen] = useState<"top" | "source" | "prop" | "level">("top");
  const top = () => setScreen("top");
  const prop = database?.props.find((p) => p.id === props.propId);

  if (screen === "source")
    return (
      <PageSourceScreen
        roomId={ctx.roomId}
        canThisPage={!!ctx.page}
        thisDbId={ctx.page?.dbId}
        dbId={props.dbId}
        pageId={props.pageId}
        // データベースが変わったら、項目は選び直す
        onPick={(next, dbChanged) => {
          onChange({ ...next, ...(dbChanged ? { propId: "" } : {}) });
          top();
        }}
        onBack={top}
      />
    );
  if (screen === "prop" && database)
    return (
      <PropScreen
        // チャットの項目は文字にできないので出さない
        props={database.props.filter((p) => p.type !== "chat" && p.type !== "imageChat")}
        selected={props.propId}
        onPick={(id) => {
          onChange({ propId: id });
          top();
        }}
        onBack={top}
      />
    );
  if (screen === "level")
    return (
      <ChoiceScreen
        title="文字の大きさ"
        items={Object.entries(LEVEL_LABEL).map(([id, label]) => ({ id, label, labelClassName: LEVEL_PREVIEW[id] }))}
        selected={props.level}
        onPick={(level) => {
          onChange({ level });
          top();
        }}
        onBack={top}
      />
    );
  return (
    <div>
      <MenuTitle>データベースと繋いだテキストの設定</MenuTitle>
      <NavRow icon="db" label="ソース" value={sourceText(props.pageId === THIS_PAGE, !!ctx.page, database, page)} onClick={() => setScreen("source")} />
      <NavRow icon="tag" label="項目" value={prop?.name ?? "選んでいません"} onClick={() => setScreen("prop")} disabled={!database} />
      <NavRow icon="text" label="文字の大きさ" value={LEVEL_LABEL[props.level] ?? LEVEL_LABEL["0"]} onClick={() => setScreen("level")} />
      <ToggleRow icon="smile" label="アイコンを表示" note="前に、ページのアイコンを出す（押すとアイコンを変えられる）" on={props.icon === "1"} onChange={(on) => onChange({ icon: on ? "1" : "" })} />
      <MenuDivider />
      <TextField label="後ろに付ける言葉" defaultValue={props.suffix} onChange={(suffix) => onChange({ suffix })} placeholder="例：様の依頼" />
      <MenuDivider />
      <MenuItem icon={<Icon name="x" size={16} />} onClick={onUnbind}>
        繋ぎを外す（テキストに戻す）
      </MenuItem>
    </div>
  );
}

function FieldInput({ value, onSave, placeholder }: { value: string; onSave: (v: string) => void; placeholder: string }) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
      placeholder={placeholder}
      aria-label={placeholder}
      className="max-w-full min-w-[3em] rounded-[6px] bg-transparent outline-none [field-sizing:content] hover:bg-tint focus:bg-tint"
      // 入力欄の幅を、中の文字の長さぴったりにする
    />
  );
}
