"use client";

import { useContext, useState } from "react";
import { PageSourceScreen, PropScreen, sourceText, THIS_PAGE } from "@/components/blockSettings";
import { NewPageDialog } from "@/components/db/NewPageDialog";
import { InnerPeekContext, SubPeekContext, usePeek } from "@/components/db/PageLink";
import { collectItems, parseDbs } from "@/components/calendar/CalendarBlock";
import { Checkbox } from "@/components/ui/Checkbox";
import { confirmAction, toast } from "@/components/ui/overlay";
import { SettingsButton, useNoteContext } from "@/components/embeds";
import { MenuDivider, Popover, usePopover } from "@/components/ui/Popover";
import { Icon } from "@/components/Icon";
import { ChoiceScreen, EmptyNote, MenuTitle, NavRow, OptionRow, SectionHead, TextField, ToggleRow } from "@/components/ui/SettingsMenu";
import type { Database, DbPage } from "@/lib/local/db";
import { createInnerNote, setInnerKind } from "@/lib/local/notes";
import { addTodo, deleteEvent, deleteTodo, restoreTodo, saveCalEvent, setEventDone, toggleTodo, useCalendarEvents, useDatabases, usePage, usePagesOf, useRoomCalendars, useTodos, type RoomCalendar } from "@/lib/local/requests";
import { today } from "@/lib/requests/logic";

// ホームなどで使う道具のブロック（ToDo・追加ボタン・ボタン）。ノートにもウィンドウにも置ける

// ---- ToDo：ルームのやることリスト。ソースでカレンダーを選ぶと、その日の予定を並べる ----

/**
 * ToDo のブロック。source が "" ならルームの ToDo（追加・チェック・削除）。
 * "room"（ルームの予定）か "cal:ID"（そのカレンダーブロック）なら、今日の予定を並べ、チェックで済みに、追加でそのソースの今日に予定を入れる。
 * ウィンドウでは残りの高さいっぱいに広げ、入りきらないときは中をスクロール
 */
export function TodoBlockView({ fill, source, onChange }: { fill?: boolean; source: string; onChange: (patch: { source: string }) => void }) {
  const { roomId, locked } = useNoteContext();
  const calendars = useRoomCalendars(roomId);
  const calId = source.startsWith("cal:") ? source.slice(4) : "";
  const cal = calId ? calendars?.find((c) => c.calendarId === calId) : undefined;
  const label = source === "room" ? "ルームの予定" : cal ? cal.label : calId ? (calendars ? "見つからないカレンダー" : "") : "";
  return (
    <section
      className={`w-full rounded-[14px] border border-line bg-card p-3 ${fill ? "flex h-full flex-col" : ""}`}
      data-fill={fill ? "" : undefined}
      contentEditable={false}
      data-name="ToDo"
    >
      {/* data-block-head / data-block-title：タブの中では見出し（タブの名前と同じ）を出さない */}
      <div className="mb-2 flex items-center gap-2 text-sm" data-block-head="" data-locked={locked ? "" : undefined}>
        <span className="flex min-w-0 items-center gap-2" data-block-title="">
          <Icon name="checkbox" size={16} className="shrink-0 text-muted" />
          <b className="shrink-0">ToDo</b>
          {source && <span className="min-w-0 truncate text-xs text-muted">今日（{md(today())}）・{label}</span>}
        </span>
        {!locked && (
          <SettingsButton label="ToDo の設定">
            <TodoMenu source={source} calendars={calendars ?? []} onChange={onChange} />
          </SettingsButton>
        )}
      </div>
      {source ? <TodayEvents source={source} cal={cal} fill={fill} /> : <RoomTodos fill={fill} />}
    </section>
  );
}

/** 「10/14」の形 */
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))}`;

/** 残りの数と「＋」の行。「＋」を押すと、ポップアップで入力欄が出る（Enter か「追加」で足して、続けて入力できる） */
function AddRow({ left, label, disabled, onAdd }: { left: string; label: string; disabled?: string; onAdd: (text: string) => Promise<unknown> }) {
  const pop = usePopover();
  const [text, setText] = useState("");
  return (
    <div className="-mt-1 mb-1 flex items-center gap-2">
      <span className="text-xs text-muted">{left}</span>
      <button
        type="button"
        onClick={pop.toggle}
        disabled={!!disabled}
        aria-label={label}
        title={disabled ?? label}
        className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted enabled:hover:bg-tint enabled:hover:text-ink disabled:opacity-40"
      >
        <Icon name="add" size={18} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={280} align="end" label={label}>
          <form
            className="flex gap-2 p-1"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              await onAdd(text.trim());
              setText("");
            }}
          >
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={label} aria-label={label} className="field" />
            <button className="btn w-10 shrink-0 px-0" aria-label="追加" disabled={!text.trim()}>
              <Icon name="add" />
            </button>
          </form>
        </Popover>
      )}
    </div>
  );
}

/** ルームの ToDo（追加・チェック・削除） */
function RoomTodos({ fill }: { fill?: boolean }) {
  const { roomId } = useNoteContext();
  const todos = useTodos(roomId) ?? [];
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  return (
    <>
      <AddRow left={open.length ? `のこり${open.length}つ` : ""} label="やることを追加" onAdd={(text) => addTodo(roomId, text)} />
      <ul className={`space-y-0.5 ${fill ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
        {[...open, ...done].map((t) => (
          <li key={t.id} className="group flex items-center gap-2 rounded-[8px] px-1 py-1 hover:bg-tint">
            <Checkbox checked={t.done} onChange={(on) => toggleTodo(t.id, on)} label={t.text} size="sm" />
            <span className={`min-w-0 flex-1 break-words ${t.done ? "text-muted line-through" : ""}`}>{t.text}</span>
            <button
              aria-label="削除"
              onClick={async () => {
                const gone = await deleteTodo(t.id);
                if (gone) toast(`「${gone.text}」を削除しました`, { label: "元に戻す", run: () => void restoreTodo(gone) });
              }}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-tint focus:opacity-100 max-md:opacity-50"
            >
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
        {!todos.length && <li className="px-1 py-1 text-sm text-muted">やることはありません</li>}
      </ul>
    </>
  );
}

/**
 * ソース（ルームの予定・カレンダーブロック）の今日の予定。チェックで済み、×で削除（確かめてから）。
 * カレンダーブロックがデータベースの日付も出していれば、今日のものを一緒に並べる（押すとページを開く。チェックは無い）。
 * 追加すると、そのソースの今日に終日の予定を入れる（カレンダーブロックは、このカレンダーの予定を出していればそこ、出していなければルームの予定）
 */
function TodayEvents({ source, cal, fill }: { source: string; cal?: RoomCalendar; fill?: boolean }) {
  const { roomId } = useNoteContext();
  const peek = usePeek();
  const now = today();
  const room = source === "room" || !!cal?.room;
  const ownId = cal?.own ? cal.calendarId : "";
  const events = useCalendarEvents(roomId, ownId, room) ?? [];
  const sources = parseDbs(cal?.dbs ?? "[]");
  const databases = useDatabases(roomId) ?? [];
  const pages = usePagesOf(sources.map((s) => s.dbId)) ?? [];
  const items = collectItems({ events, sources, databases, pages, from: now, to: now }).get(now) ?? [];
  // 済みは下へ
  const list = [...items.filter((it) => !it.done), ...items.filter((it) => it.done)];
  const target = source === "room" ? "room" : cal ? (cal.own ? "own" : cal.room ? "room" : null) : null;
  return (
    <>
      <AddRow
        left={items.length ? `のこり${items.filter((it) => !it.done).length}つ` : ""}
        label="今日の予定を追加"
        disabled={!target ? "カレンダーが見つかりません" : undefined}
        onAdd={(text) => saveCalEvent(roomId, null, { text, date: now, calendarId: target === "own" ? cal?.calendarId : undefined })}
      />
      <ul className={`space-y-0.5 ${fill ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
        {list.map((it) => (
          <li key={it.key} className="group flex items-center gap-2 rounded-[8px] px-1 py-1 hover:bg-tint">
            {it.event ? (
              <Checkbox checked={!!it.done} onChange={(on) => void setEventDone(it.event!.id, on)} label={it.text} size="sm" />
            ) : (
              <Icon name="db" size={16} className="shrink-0 text-muted" />
            )}
            {/* 色の印と時刻（何日かにわたる予定は、いつまでか） */}
            <span className="h-3 w-1 shrink-0 rounded-full" style={{ background: it.hue }} />
            {it.event?.time && <span className="shrink-0 text-xs text-muted">{it.event.time}</span>}
            {it.page ? (
              <button type="button" onClick={() => peek(it.page!.database, it.page!.pageId)} className={`min-w-0 flex-1 text-left break-words hover:underline ${it.done ? "text-muted line-through" : ""}`}>
                {it.text}
              </button>
            ) : (
              <span className={`min-w-0 flex-1 break-words ${it.done ? "text-muted line-through" : ""}`}>
                {it.text}
                {it.event?.end && it.event.end > it.event.date && <span className="ml-1 text-xs text-muted">（〜{md(it.event.end)}）</span>}
              </span>
            )}
            {it.event && (
              <button
                aria-label="削除"
                onClick={async () => {
                  if (await confirmAction(`「${it.text}」を削除します`, "削除", "カレンダーからも消えます")) await deleteEvent(it.event!.id);
                }}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-tint focus:opacity-100 max-md:opacity-50"
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </li>
        ))}
        {!list.length && <li className="px-1 py-1 text-sm text-muted">今日の予定はありません</li>}
      </ul>
    </>
  );
}

/** ToDo の設定：ソース（ルームの ToDo・ルームの予定・ルームの中のカレンダーブロック） */
function TodoMenu({ source, calendars, onChange }: { source: string; calendars: RoomCalendar[]; onChange: (patch: { source: string }) => void }) {
  return (
    <div>
      <MenuTitle>ToDo の設定</MenuTitle>
      <SectionHead label="ソース" />
      <OptionRow icon="checkbox" selected={source === ""} onClick={() => onChange({ source: "" })} note="ルームのやることリスト">
        ToDo
      </OptionRow>
      <OptionRow icon="calendar" selected={source === "room"} onClick={() => onChange({ source: "room" })} note="今日のルームの予定。追加すると、ルームの今日に予定が入る">
        ルームの予定
      </OptionRow>
      <SectionHead label="カレンダー（今日の予定。追加すると、そのカレンダーの今日に入る）" />
      {calendars.map((c) => (
        <OptionRow key={c.calendarId} icon="calendar" selected={source === `cal:${c.calendarId}`} onClick={() => onChange({ source: `cal:${c.calendarId}` })}>
          {c.label}
        </OptionRow>
      ))}
      {!calendars.length && <EmptyNote>カレンダーのブロックがまだありません（ノートやウィンドウに「カレンダー」を置くと選べます）</EmptyNote>}
    </div>
  );
}

// ---- 追加ボタン：データベースにページを足すボタン ----

/** 追加ボタンの props（ブロックの props と同じ）。templateId は "" なら既定のテンプレート、"none" ならテンプレートを使わない。align は "right" で右に寄せる */
export type AddButtonProps = { dbId: string; templateId: string; label: string; align: string };

/** 足す先のデータベース。選んでいなければ、依頼のデータベース（無ければ最初のもの） */
const targetOf = (databases: Database[], dbId: string) => (dbId ? databases.find((d) => d.id === dbId) : (databases.find((d) => d.kind === "request") ?? databases[0]));

const templateOf = (database: Database | undefined, templateId: string) =>
  !database || templateId === "none" ? undefined : database.templates?.find((t) => t.id === (templateId || database.defaultTemplateId));

/** 押すと、データベースにページを足す画面を出すボタン（ホームの「ページを追加」） */
export function AddButtonView({ props, onChange }: { props: AddButtonProps; onChange: (patch: Partial<AddButtonProps>) => void }) {
  const ctx = useNoteContext();
  const databases = useDatabases(ctx.roomId) ?? [];
  const database = targetOf(databases, props.dbId);
  const [adding, setAdding] = useState(false);
  const label = props.label || (database ? `ページを追加` : "追加");

  return (
    <div className={`flex w-full items-center gap-1 ${props.align === "right" ? "justify-end" : ""}`} contentEditable={false} data-name="追加ボタン">
      <button className="btn" disabled={!database} onClick={() => setAdding(true)} title={database ? `「${database.name}」に足す` : "歯車からデータベースを選んでください"}>
        <Icon name="add" />
        {label}
      </button>
      {!ctx.locked && (
        <SettingsButton label="追加ボタンの設定">
          <AddButtonMenu props={props} databases={databases} database={database} onChange={onChange} />
        </SettingsButton>
      )}
      {adding && database && (
        <NewPageDialog database={database} members={ctx.members} userId={ctx.userId} template={templateOf(database, props.templateId)} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

/** 追加ボタンの設定：ボタンの文字・ソース（足す先のデータベース）・テンプレート・右に寄せる */
function AddButtonMenu({ props, databases, database, onChange }: { props: AddButtonProps; databases: Database[]; database?: Database; onChange: (patch: Partial<AddButtonProps>) => void }) {
  const [screen, setScreen] = useState<"top" | "source" | "template">("top");
  const top = () => setScreen("top");
  const fallback = database ? database.templates?.find((t) => t.id === database.defaultTemplateId) : undefined;
  const templateText = props.templateId === "none" ? "使わない" : (templateOf(database, props.templateId)?.name ?? (props.templateId ? "見つかりません" : "使わない"));

  if (screen === "source")
    return (
      <ChoiceScreen
        title="ソース"
        section="ページを足すデータベース"
        items={databases.map((d) => ({ id: d.id, label: d.name, icon: "db" as const, emoji: d.icon }))}
        selected={database?.id ?? ""}
        // データベースを変えたら、テンプレートはそのデータベースの既定に戻す
        onPick={(id) => {
          onChange({ dbId: id, templateId: "" });
          top();
        }}
        onBack={top}
      />
    );
  if (screen === "template" && database)
    return (
      <ChoiceScreen
        title="テンプレート"
        items={[
          { id: "", label: `既定のテンプレート${fallback ? `（${fallback.name}）` : "（なし）"}`, icon: "star" as const },
          { id: "none", label: "テンプレートを使わない", icon: "x" as const },
          ...(database.templates ?? []).map((t) => ({ id: t.id, label: t.name, icon: "note" as const, emoji: t.icon })),
        ]}
        selected={props.templateId}
        onPick={(id) => {
          onChange({ templateId: id });
          top();
        }}
        onBack={top}
      />
    );
  return (
    <div>
      <MenuTitle>追加ボタンの設定</MenuTitle>
      <TextField label="ボタンの文字" defaultValue={props.label} onChange={(label) => onChange({ label })} placeholder={database ? `ページを追加` : "追加"} />
      <NavRow icon="db" label="ソース" value={database?.name ?? "選んでいません"} onClick={() => setScreen("source")} />
      <NavRow icon="note" label="テンプレート" value={templateText} onClick={() => setScreen("template")} disabled={!database} />
      <ToggleRow icon="r" label="右に寄せる" on={props.align === "right"} onChange={(on) => onChange({ align: on ? "right" : "" })} />
    </div>
  );
}

// ---- ボタン：押すと、ボタンの中のノート・ウィンドウか、別ページ（データベースの「ページ」の項目）をポップアップで出す ----

/**
 * ボタンの props（ブロックの props と同じ）。kind が "note"・"window" なら、開くのはボタンの中のページ（noteId。チャンネルとは別）。
 * kind が "" なら、どのページ（pageId。"@this" はこのページ）の、どの「ページ」の項目か。align は "right" で右に寄せる
 */
export type LinkButtonProps = { label: string; kind: string; noteId: string; dbId: string; pageId: string; propId: string; align: string };

/** 開くものがボタンの中のページのときの形（それ以外は null：データベースのページの「ページ」の項目） */
const innerKindOf = (kind: string) => (kind === "note" || kind === "window" ? kind : null);
const OPEN_KINDS: { id: "note" | "window" | ""; label: string; icon: "note" | "window" | "db"; note: string }[] = [
  { id: "note", label: "ノート", icon: "note", note: "ボタンの中に書くページ（下に伸びる）" },
  { id: "window", label: "ウィンドウ", icon: "window", note: "ボタンの中に部品を並べるページ（画面に固定）" },
  { id: "", label: "データベースの「ページ」の項目", icon: "db", note: "ページの「ページ」の項目の別ページ" },
];

/** 押すと、ボタンの中のページ（ノート・ウィンドウ）か、リンク先の別ページをポップアップで出すボタン。ボタンの中のページなら、データベースが無くても使える */
export function LinkButtonView({ props, onChange }: { props: LinkButtonProps; onChange: (patch: Partial<LinkButtonProps>) => void }) {
  const ctx = useNoteContext();
  const openSub = useContext(SubPeekContext);
  const openInner = useContext(InnerPeekContext);
  const databases = useDatabases(ctx.roomId) ?? [];
  const inner = innerKindOf(props.kind);
  const thisPage = props.pageId === THIS_PAGE;
  // 「このページ」のときは、今のページのデータベースとページ
  const database = inner ? undefined : databases.find((d) => d.id === (thisPage ? (ctx.page?.dbId ?? "") : props.dbId));
  const page = usePage((inner ? "" : thisPage ? ctx.page?.pageId : props.pageId) ?? "");
  const prop = database?.props.find((p) => p.id === props.propId && p.type === "page");
  const label = props.label || (inner ? `${inner === "window" ? "ウィンドウ" : "ノート"}を開く` : prop?.name) || "ボタン";
  const pick = ctx.locked ? "編集モードで、歯車から開くものを選んでください" : "歯車から開くものを選んでください";
  // 押せないわけ（押せるときは空）。ボタンの中のページがまだ無いときは、編集できるところなら押したときに作る
  const why = inner
    ? !props.noteId && ctx.locked
      ? "編集モードにして押すと、ボタンの中のページができます"
      : !openInner
        ? "ここでは開けません"
        : ""
    : !database || !prop
      ? pick
      : !page
        ? thisPage && ctx.template
          ? "テンプレートの中では開けません（このテンプレートで作ったページで押せます）"
          : "リンク先のページが見つかりません"
        : !openSub
          ? "ここでは開けません"
          : "";
  const open = async () => {
    if (inner) {
      let noteId = props.noteId;
      if (!noteId) {
        noteId = (await createInnerNote(ctx.roomId, ctx.userId, inner, label)).id;
        onChange({ noteId });
      }
      // ポップアップの見出しは、ボタンの文字（決めていなければ「ボタンの中のノート」など）
      return openInner?.({ roomId: ctx.roomId, noteId, title: props.label || `ボタンの中の${inner === "window" ? "ウィンドウ" : "ノート"}`, page: ctx.page });
    }
    if (database && page && prop) openSub?.({ roomId: ctx.roomId, dbId: database.id, pageId: page.id, propId: prop.id });
  };

  return (
    <div className={`flex w-full items-center gap-1 ${props.align === "right" ? "justify-end" : ""}`} contentEditable={false} data-name="ボタン">
      <button className="btn" disabled={!!why} title={why || `「${label}」をポップアップで開く`} onClick={() => void open()}>
        {label}
      </button>
      {!ctx.locked && (
        <SettingsButton label="ボタンの設定">
          <LinkButtonMenu props={props} database={database} page={page ?? undefined} onChange={onChange} />
        </SettingsButton>
      )}
    </div>
  );
}

/** ボタンの設定：ボタンの文字・開くもの（ボタンの中のノート・ウィンドウか、データベースの「ページ」の項目）・右に寄せる */
function LinkButtonMenu({ props, database, page, onChange }: { props: LinkButtonProps; database?: Database; page?: DbPage; onChange: (patch: Partial<LinkButtonProps>) => void }) {
  const ctx = useNoteContext();
  const [screen, setScreen] = useState<"top" | "kind" | "source" | "prop">("top");
  const top = () => setScreen("top");
  const inner = innerKindOf(props.kind);
  const kind = OPEN_KINDS.find((k) => k.id === (inner ?? "")) ?? OPEN_KINDS[2];
  const pageProps = database?.props.filter((p) => p.type === "page") ?? [];
  const prop = pageProps.find((p) => p.id === props.propId);

  if (screen === "kind")
    return (
      <ChoiceScreen
        title="開くもの"
        items={OPEN_KINDS}
        selected={inner ?? ""}
        onPick={(id) => {
          // ボタンの中のページは、はじめて選んだときに作る（ノートとウィンドウを切り替えても、中身はそのまま）
          if ((id === "note" || id === "window") && props.noteId) void setInnerKind(props.noteId, id);
          if ((id === "note" || id === "window") && !props.noteId)
            void createInnerNote(ctx.roomId, ctx.userId, id, props.label || "ボタンの中のページ").then((n) => onChange({ kind: id, noteId: n.id }));
          else onChange({ kind: id });
          top();
        }}
        onBack={top}
      />
    );
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
        props={pageProps}
        selected={props.propId}
        onPick={(id) => {
          onChange({ propId: id });
          top();
        }}
        onBack={top}
      />
    );
  return (
    <div>
      <MenuTitle>ボタンの設定</MenuTitle>
      <TextField label="ボタンの文字" defaultValue={props.label} onChange={(label) => onChange({ label })} placeholder={inner ? `${kind.label}を開く` : (prop?.name ?? "ボタン")} />
      <SectionHead label="押すとポップアップで開くもの" />
      <NavRow icon={kind.icon} label="開くもの" value={kind.label} onClick={() => setScreen("kind")} />
      {inner ? (
        <EmptyNote>中身は、ボタンを押して開いたポップアップで{inner === "window" ? "「編集」から並べます" : "書きます"}（このボタンだけのページで、サイドバーには出ません）</EmptyNote>
      ) : (
        <>
          <NavRow icon="db" label="ソース" value={sourceText(props.pageId === THIS_PAGE, !!ctx.page, database, page)} onClick={() => setScreen("source")} />
          <NavRow icon="note" label="ページの項目" value={prop?.name ?? "選んでいません"} onClick={() => setScreen("prop")} disabled={!database} />
          {database && !pageProps.length && <EmptyNote>「{database.name}」に「ページ」の項目がありません。データベースの「＋」から足してください</EmptyNote>}
        </>
      )}
      <MenuDivider />
      <ToggleRow icon="r" label="右に寄せる" on={props.align === "right"} onChange={(on) => onChange({ align: on ? "right" : "" })} />
    </div>
  );
}
