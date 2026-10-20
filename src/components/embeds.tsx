"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { CalendarBlockView } from "@/components/calendar/CalendarBlock";
import { ChatImagesButton } from "@/components/chat/ChatImages";
import { ChatNotifyButton } from "@/components/chat/ChatNotify";
import { ChatSearchButton } from "@/components/chat/ChatSearch";
import { ChatView } from "@/components/chat/ChatView";
import { ImageChatView } from "@/components/chat/ImageChatView";
import { PageSourceScreen, PropScreen, PropVisibilityScreen, sourceText, THIS_PAGE, WritersScreen, writersText } from "@/components/blockSettings";
import { VIEW_TYPES } from "@/components/db/meta";
import { ViewSaveContext } from "@/components/db/viewSave";
import { ViewSettingsMenu } from "@/components/db/ViewSettings";
import { PropValue } from "@/components/db/values";
import { CircleGauge, Gauge } from "@/components/db/views/common";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover } from "@/components/ui/Popover";
import { PopupDialog } from "@/components/ui/Dialog";
import { TabStrip } from "@/components/ui/TabStrip";
import { BackHead, MenuTitle, NavRow, SectionHead, ToggleRow } from "@/components/ui/SettingsMenu";
import { createBlockChat, setChatAllowed, useChat } from "@/lib/local/chat";
import type { Chat, Database, DbPage, DbView, ImageUser, Profile, Property, ViewType } from "@/lib/local/db";
import { copyView, type BlockView } from "@/lib/local/windowLayout";
import { dueLabel, valueOf } from "@/lib/requests/logic";
import { percentOf } from "@/lib/requests/stages";
import { Icon, type IconName } from "@/components/Icon";
import { IconMark } from "@/components/IconMark";
import { ImageViewer } from "@/components/ImageViewer";
import { MediaPicker } from "@/components/MediaPicker";
import { ViewRenderer } from "@/components/db/views/ViewRenderer";
import { useMediaByIds } from "@/lib/local/media";
import { updatePageValue, updateProperty, useDatabases, useEvents, usePage, usePages, useViews } from "@/lib/local/requests";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { useBlobUrl } from "@/lib/media/blob-url";
import type { EmbedKind } from "@/components/blockKinds";
import { DbChatBlock, PageBlockBody, PropChatView, seedUsers, StageButton, StagePills, stageDatesOf } from "@/components/pageBlocks";
import { AddButtonView, LinkButtonView, TodoBlockView } from "@/components/toolBlocks";
import { isDateLike } from "@/lib/requests/formula";
import { ChatSkeleton, ViewSkeleton } from "@/components/Skeleton";

// ノートのブロックとウィンドウの部品で共通に使う中身（エディタに依存しない）

/** ブロック・部品の中から、ルーム・利用者を参照するための入れ物。owner はブロックのチャットの持ち主（note:ID / window:ID） */
/** locked：ウィンドウの編集モードでないとき。チャットの書き込める人やビューの選び直しなど、設定を変えられないようにする */
export const NoteContext = createContext<{
  roomId: string;
  userId: string;
  members: MemberWithProfile[];
  owner: string;
  locked?: boolean;
  /** テンプレートを編集しているとき。チャットは作らず、ページを作ったときにそのページ用にできる */
  template?: boolean;
  /** データベースのページの本文（とそのテンプレート）のとき。ページのブロックが、このページのタイトル・項目・チャットを出す */
  page?: { dbId: string; pageId?: string };
  /** ウィンドウ（画面固定）のとき。チャットなどのブロックを残りの高さいっぱいに広げる */
  windowMode?: boolean;
  /** テンプレートと繋いだチャンネルのとき：チャットのブロックは、ブロックに書かず、このチャンネル用のチャットを使う（使う先ごとに別） */
  linkedChats?: { get: (blockId: string) => string | undefined; set: (blockId: string, chatId: string) => void };
} | null>(null);
export const useNoteContext = () => {
  const v = useContext(NoteContext);
  if (!v) throw new Error("NoteContext がありません");
  return v;
};

export const WIDTHS = {
  s: "max-w-[240px]",
  m: "max-w-[420px]",
  l: "max-w-[640px]",
  full: "max-w-full",
} as const;
export const WIDTH_LABEL = { s: "小", m: "中", l: "大", full: "全幅" } as const;

// ---- ブロックの設定ボタン（歯車）：押すと、ブロックの中ではなくポップアップで設定を出す ----

/**
 * 中身は設定の画面（components/ui/SettingsMenu の部品で、Notion のビューの設定と同じ形にする）。
 * 中身を関数にすると、ポップアップを閉じる関数を受け取れる
 */
export function SettingsButton({ label, children, width = 300 }: { label: string; children: React.ReactNode | ((close: () => void) => React.ReactNode); width?: number }) {
  const pop = usePopover();
  return (
    <>
      <button
        onClick={pop.toggle}
        aria-expanded={!!pop.anchor}
        className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink"
        aria-label={label}
        title={label}
      >
        <Icon name="gear" size={14} />
      </button>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={width} align="end" label={label}>
          {typeof children === "function" ? children(pop.close) : children}
        </Popover>
      )}
    </>
  );
}

// ---- 画像（メディアから）：画像は必ずメディアに入っているものを貼る ----

export type Width = keyof typeof WIDTHS;

export function MediaImageView({
  mediaId,
  width,
  onPick,
  onWidth,
  fill,
}: {
  mediaId: string;
  width: Width;
  onPick: (ids: string[]) => void;
  onWidth?: (w: Width) => void;
  fill?: boolean;
}) {
  const { roomId, userId, locked } = useNoteContext();
  // 貼った画像は、どのボックスに入っていても ID で引く
  const media = useMediaByIds(mediaId ? [mediaId] : []);
  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState(false);
  const m = media?.get(mediaId);
  const url = useBlobUrl(mediaId || undefined, "original");

  const picker = picking && (
    <MediaPicker
      roomId={roomId}
      userId={userId}
      onClose={() => setPicking(false)}
      onPick={(ids) => {
        setPicking(false);
        if (ids.length) onPick(ids);
      }}
    />
  );

  if (!mediaId) {
    return (
      <div className={`w-full ${fill ? "h-full p-2" : ""}`} contentEditable={false}>
        {locked ? (
          <div className="grid h-full w-full place-items-center rounded-[12px] border border-dashed border-line py-6 text-sm text-muted">画像は編集モードで選べます</div>
        ) : (
          <button
            onClick={() => setPicking(true)}
            className="flex h-full w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-line py-6 text-muted hover:bg-tint"
          >
            <Icon name="img" />
            メディアから画像を選ぶ
          </button>
        )}
        {picker}
      </div>
    );
  }
  return (
    <figure className={`group relative w-full ${fill ? "flex h-full flex-col p-2" : WIDTHS[width]}`} contentEditable={false} data-fill={fill ? "" : undefined}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- ブラウザ内の Blob なので next/image は使えない
        <img
          src={url}
          alt={m?.name ?? ""}
          onClick={() => setViewing(true)}
          className={fill ? "min-h-0 w-full flex-1 cursor-zoom-in rounded-[10px] object-contain" : "block w-full cursor-zoom-in rounded-[10px]"}
        />
      ) : (
        <div className="grid aspect-video w-full place-items-center rounded-[10px] border border-dashed border-line text-sm text-muted">
          {media && !m ? "この画像はメディアから削除されました" : <span className="loading">読み込み中…</span>}
        </div>
      )}
      {m && <figcaption className="mt-1 text-xs text-muted">{m.name}</figcaption>}
      {!locked && (
        <div className="absolute top-2 right-2 flex gap-1 rounded-full bg-black/60 p-1 text-xs text-white opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-80">
          {onWidth &&
            (Object.keys(WIDTHS) as Width[]).map((w) => (
              <button key={w} onClick={() => onWidth(w)} className={`rounded-full px-2 py-0.5 ${width === w ? "bg-white text-black" : "hover:bg-white/20"}`}>
                {WIDTH_LABEL[w]}
              </button>
            ))}
          <button onClick={() => setPicking(true)} className="rounded-full px-2 py-0.5 hover:bg-white/20">
            差し替え
          </button>
        </div>
      )}
      {picker}
      {viewing && m && <ImageViewer items={[m]} start={0} roomId={roomId} onClose={() => setViewing(false)} />}
    </figure>
  );
}

// ---- チャット・イメージチャット ----

/** ブロックに置くチャット。最初に表示したときにチャットを作る */
export function ChatBlockView({
  chatId,
  kind,
  onCreated,
  fill,
  seed,
  onSeed,
}: {
  chatId: string;
  kind: "normal" | "image";
  onCreated: (id: string) => void;
  fill?: boolean;
  /** イメージチャットで "page" のとき、依頼者（ページの名前）と参加者を最初から話す人に入れる */
  seed?: string;
  onSeed?: (seed: string) => void;
}) {
  const { roomId, userId, members, owner, locked, template, page: pageScope } = useNoteContext();
  const page = usePage(pageScope?.pageId ?? "");
  const chat = useChat(chatId);
  const creating = useRef(false);
  useEffect(() => {
    if (chatId || creating.current || template) return;
    creating.current = true;
    void createBlockChat(roomId, owner, kind).then((c) => onCreated(c.id));
  }, [chatId, roomId, owner, kind, onCreated, template]);

  const me: Profile = {
    id: userId,
    displayName: members.find((m) => m.userId === userId)?.displayName ?? "",
    username: "",
    createdAt: 0,
  };
  const allowed = chat?.allowed;
  const canTalk = !allowed?.length || allowed.includes(userId);
  // 依頼者（ページの名前）と参加者（書き込める人、選んでいなければルームの全員）を、最初から話す人に入れる
  const fixedUsers: ImageUser[] = kind === "image" && seed === "page" ? seedUsers(roomId, page, members, allowed) : [];
  const label = kind === "image" ? "イメージチャットの設定" : "チャットの設定";

  return (
    <div
      className={`w-full overflow-hidden rounded-[14px] border border-line bg-card ${fill ? "flex h-full flex-col" : ""}`}
      data-fill={fill ? "" : undefined}
      contentEditable={false}
      data-name={kind === "image" ? "イメージチャットブロック" : "チャットブロック"}
    >
      {/* data-block-head / data-block-title：タブの中では、見出し（タブの名前と同じになる）を出さない。読むだけのときは段ごと出さない（data-block-keep の検索・通知などのボタンがあれば、段は残す） */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-sm" data-block-head="" data-locked={locked ? "" : undefined}>
        <span className="flex items-center gap-2" data-block-title="">
          <Icon name={kind === "image" ? "ppl" : "chat"} size={16} className="text-muted" />
          <b>{kind === "image" ? "イメージチャット" : "チャット"}</b>
        </span>
        {/* 書き込める人を選んでいるときだけ、誰が書き込めるかを出す（選ぶのは歯車の設定から） */}
        {allowed?.length ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted" title="書き込める人">
            <Icon name="person" size={14} className="shrink-0" />
            <span className="truncate">{writersText(members, allowed)}</span>
          </span>
        ) : null}
        {/* 右上：送られた画像（チャットのチャンネルと同じ）と、設定の歯車 */}
        <span className="ml-auto flex shrink-0 items-center gap-0.5" data-block-keep={chat ? "" : undefined}>
          {chat && <ChatSearchButton chatId={chat.id} roomId={roomId} compact />}
          {chat && <ChatImagesButton chatId={chat.id} roomId={roomId} compact />}
          {chat && <ChatNotifyButton chatId={chat.id} compact />}
          {!locked && (
            <SettingsButton label={label}>
              <ChatMenu title={label} kind={kind} chat={chat} seed={seed} onSeed={onSeed} />
            </SettingsButton>
          )}
        </span>
      </div>
      <div className={fill ? "min-h-0 flex-1 p-3" : "h-[420px] p-3"}>
        {!chat ? (
          <p className="text-sm text-muted">{template ? "テンプレートを使う先（ページ・ウィンドウ・ノート）ごとに、ここにチャットができます" : "準備中…"}</p>
        ) : kind === "image" ? (
          <ImageChatView chat={chat} me={me} fixedUsers={fixedUsers} readOnlyNotice={canTalk ? undefined : "このイメージチャットに書き込めるのは、選ばれた人だけです"} />
        ) : (
          <ChatView chat={chat} me={me} members={members} readOnlyNotice={canTalk ? undefined : "このチャットで話せるのは、選ばれた人だけです"} />
        )}
      </div>
    </div>
  );
}

/** チャット・イメージチャットの設定：書き込める人と、（イメージチャットは）依頼者と参加者を最初から話す人に入れるか */
function ChatMenu({ title, kind, chat, seed, onSeed }: { title: string; kind: "normal" | "image"; chat: Chat | null | undefined; seed?: string; onSeed?: (seed: string) => void }) {
  const { members } = useNoteContext();
  const [screen, setScreen] = useState<"top" | "writers">("top");
  if (screen === "writers" && chat)
    return <WritersScreen members={members} allowed={chat.allowed ?? []} onChange={(next) => void setChatAllowed(chat.id, next)} onBack={() => setScreen("top")} />;
  return (
    <div>
      <MenuTitle>{title}</MenuTitle>
      <NavRow
        icon="person"
        label="書き込める人"
        value={chat ? writersText(members, chat.allowed) : "チャットができてから選べます"}
        onClick={() => setScreen("writers")}
        disabled={!chat}
      />
      {kind === "image" && onSeed && (
        <ToggleRow
          icon="ppl"
          label="依頼者と参加者を話す人に入れる"
          note="ページの名前（依頼者）と書き込める人を、最初から話す人にします"
          on={seed === "page"}
          onChange={(on) => onSeed(on ? "page" : "")}
        />
      )}
    </div>
  );
}

// ---- シングルビュー：データベースの1ページの1項目だけを大きく出す ----

export type SingleDisplay = "value" | "line" | "circle";

/**
 * シングルビューの props（ブロックの props と同じ）。
 * visible：一緒に出す項目の ID の並び（JSON）／stages：期限を出す工程の項目の ID（JSON）／countdown：残りの日数で出す日付の項目の ID（JSON）／hideHead："1" で見出しを出さない
 */
export type SingleProps = {
  dbId: string;
  pageId: string;
  propId: string;
  display: SingleDisplay;
  visible: string;
  stages: string;
  countdown: string;
  hideHead: string;
};

const DISPLAY_LABEL: Record<SingleDisplay, string> = {
  value: "値",
  line: "ラインゲージ",
  circle: "サークルゲージ",
};

/** レイアウト（表示の形）の四角に出すアイコンと説明 */
const DISPLAY_TILE: Record<SingleDisplay, { icon: IconName; note: string }> = {
  value: {
    icon: "text",
    note: "項目の値をそのまま大きく出す（チャットの項目は、チャットそのものを出す）",
  },
  line: {
    icon: "chart",
    note: "進み具合を横長のゲージで出す（数値・工程の項目）",
  },
  circle: {
    icon: "status",
    note: "進み具合を丸いゲージで出す（数値・工程の項目）",
  },
};

/** 一緒に出す項目の ID の並び */
const extraIds = (visible: string): string[] => {
  try {
    const v: unknown = JSON.parse(visible || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/**
 * 項目ごとのオン・オフ（工程の期限・残りの日数）。ID の並びの JSON で持つ。
 * 前の形（"1" で全部オン）は、そのとき出していた項目（all）が全部オンとして読む
 */
const onIds = (value: string, all: Property[]): string[] => (value === "1" ? all.map((p) => p.id) : extraIds(value));

/** 一緒に出せる項目（出している項目とチャットの項目のほか） */
const extraCandidates = (database: Database, propId: string) => database.props.filter((p) => p.id !== propId && p.type !== "chat" && p.type !== "imageChat");

/** 一緒に出す項目（並べた順） */
const extraProps = (database: Database, props: SingleProps) => {
  const all = extraCandidates(database, props.propId);
  return extraIds(props.visible)
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is Property => !!p);
};

/**
 * シングルビューの設定（データベースのビューの設定と同じ形・同じ並び）：レイアウト・項目・プロパティの表示/非表示・ソース。
 * レイアウトの画面は四角を並べて選び、その下に出すもの（ソース・項目・プロパティ）と、レイアウトの設定を出す。
 * 工程の項目をラインゲージにして、納期とステータスを一緒に出し、工程の期限と残りの日数を出すと「進み具合と工程」と同じになる
 */
function SingleViewMenu({ props, database, page, onChange }: { props: SingleProps; database?: Database; page?: DbPage; onChange: (patch: Partial<SingleProps>) => void }) {
  const ctx = useNoteContext();
  const [screen, setScreen] = useState<"top" | "source" | "prop" | "layout" | "writers" | "extras">("top");
  const top = () => setScreen("top");
  // ソース・項目・プロパティの画面は、開いた画面（トップかレイアウト）に戻る
  const [from, setFrom] = useState<"top" | "layout">("top");
  const open = (to: "source" | "prop" | "extras", at: "top" | "layout") => {
    setFrom(at);
    setScreen(to);
  };
  const back = () => setScreen(from);
  const { pageId, propId, display } = props;
  const prop = database?.props.find((p) => p.id === propId);
  const gaugeable = !!prop && (prop.type === "number" || prop.type === "stage" || prop.type === "formula");
  const isChat = !!prop && (prop.type === "chat" || prop.type === "imageChat");
  // ゲージにできるのは、数値と工程の項目だけ。それ以外は「値」（チャットの項目は「チャット」）
  const shownDisplay: SingleDisplay = gaugeable ? display : "value";
  const label = (d: SingleDisplay) => (d === "value" && isChat ? "チャット" : DISPLAY_LABEL[d]);
  const extras = database ? extraProps(database, props) : [];
  // レイアウトの設定のスイッチは、出している項目（メインと一緒に出す項目）ごとに並べる。プロパティを出し入れすると増えたり減ったりする
  const shownAll = [...(prop && !isChat ? [prop] : []), ...extras];
  const stageProps = shownAll.filter((p) => p.type === "stage");
  // 日付の項目と、日付を出す数式は、残りの日数で出せる
  const dateProps = shownAll.filter((p) => !!database && isDateLike(database, p));
  const stagesOn = onIds(props.stages, stageProps);
  const countdownOn = onIds(props.countdown, dateProps);
  const flip = (list: string[], id: string, on: boolean) => JSON.stringify(on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id));

  // 出す項目・一緒に出す項目・ソースの行（トップとレイアウトの画面で同じものを出す）
  const rows = (at: "top" | "layout") => (
    <>
      <NavRow icon="tag" label="項目" value={prop?.name ?? "選んでいません"} onClick={() => open("prop", at)} disabled={!database} />
      {!isChat && (
        <NavRow icon="eye" label="プロパティの表示/非表示" value={database ? `${extras.length}個を一緒に表示` : ""} onClick={() => open("extras", at)} disabled={!database} />
      )}
      <NavRow icon="db" label="ソース" value={sourceText(pageId === THIS_PAGE, !!ctx.page, database, page)} onClick={() => open("source", at)} />
    </>
  );

  if (screen === "source")
    return (
      <PageSourceScreen
        roomId={ctx.roomId}
        canThisPage={!!ctx.page}
        thisDbId={ctx.page?.dbId}
        dbId={props.dbId}
        pageId={pageId}
        // データベースが変わったら、項目と一緒に出す項目は選び直す
        onPick={(next, dbChanged) => {
          onChange({
            ...next,
            ...(dbChanged ? { propId: "", visible: "[]" } : {}),
          });
          back();
        }}
        onBack={back}
      />
    );
  if (screen === "prop" && database)
    return (
      <PropScreen
        props={database.props}
        selected={propId}
        onPick={(id) => {
          // 一緒に出す項目に入っていたら、そこからは外す
          onChange({
            propId: id,
            visible: JSON.stringify(extraIds(props.visible).filter((x) => x !== id)),
          });
          back();
        }}
        onBack={back}
      />
    );
  if (screen === "extras" && database)
    return <PropVisibilityScreen all={extraCandidates(database, propId)} shown={extras} onSave={(ids) => onChange({ visible: JSON.stringify(ids) })} onBack={back} />;
  if (screen === "writers" && database && prop)
    return (
      <WritersScreen
        members={ctx.members}
        allowed={prop.allowed ?? []}
        onChange={(allowed) => void updateProperty(database.id, prop.id, { allowed })}
        onBack={() => setScreen("layout")}
      />
    );
  if (screen === "layout")
    return (
      // データベースのビューのレイアウトと同じく、四角を並べて選び、その下に出すものとレイアウトの設定を出す
      <div>
        <BackHead title="レイアウト" onBack={top} />
        <div className="grid grid-cols-3 gap-1.5 px-1 pb-1">
          {(Object.keys(DISPLAY_LABEL) as SingleDisplay[]).map((d) => {
            const ok = d === "value" || gaugeable;
            return (
              <button
                key={d}
                disabled={!ok}
                title={ok ? DISPLAY_TILE[d].note : "数値と工程の項目で選べます"}
                aria-pressed={shownDisplay === d}
                onClick={() => onChange({ display: d })}
                className={`grid justify-items-center gap-1 rounded-[10px] border px-1 py-2 text-[11px] whitespace-nowrap disabled:opacity-40 ${shownDisplay === d ? "border-accent bg-tint font-bold" : "border-line enabled:hover:bg-tint"}`}
              >
                <Icon name={d === "value" && isChat ? (prop?.type === "imageChat" ? "ppl" : "chat") : DISPLAY_TILE[d].icon} size={20} />
                {label(d)}
              </button>
            );
          })}
        </div>
        {/* レイアウトのボタンのすぐ下に、そのレイアウトの設定 */}
        <SectionHead label="レイアウトの設定" />
        <ToggleRow icon="text" label="見出しを出す" note="ページと項目の名前を上に出す" on={props.hideHead !== "1"} onChange={(on) => onChange({ hideHead: on ? "" : "1" })} />
        {stageProps.map((p) => {
          // 工程の設定の開始日と終了日が入っていないページでは、工程の期限の日付は出せない（工程の名前だけ並ぶ）
          const dated = page ? stageDatesOf(p, page).some((x) => x.date) : true;
          return (
            <ToggleRow
              key={`stage:${p.id}`}
              icon="timeline"
              label={`「${p.name}」の期限を出す`}
              note={dated ? "工程ごとの期限を下に並べる（押すとその工程まで進める）" : "このページは工程の設定の開始日か終了日が空なので、日付は出ず、工程の名前だけ並びます"}
              on={stagesOn.includes(p.id)}
              onChange={(on) => onChange({ stages: flip(stagesOn, p.id, on) })}
            />
          );
        })}
        {dateProps.map((p) => (
          <ToggleRow
            key={`date:${p.id}`}
            icon="calendar"
            label={`「${p.name}」を残りの日数で出す`}
            note={`例：${p.name}まで あと16日（空なら「未入力」）`}
            on={countdownOn.includes(p.id)}
            onChange={(on) => onChange({ countdown: flip(countdownOn, p.id, on) })}
          />
        ))}
        {/* レイアウトを見ながら、どのページのどの項目を出すかも選べるようにする */}
        <MenuDivider />
        {rows("layout")}
        {isChat && database && prop && (
          <>
            <MenuDivider />
            <SectionHead label="チャットの設定（この項目のすべてのページで同じ）" />
            <NavRow icon="person" label="書き込める人" value={writersText(ctx.members, prop.allowed)} onClick={() => setScreen("writers")} />
            {prop.type === "imageChat" && (
              <ToggleRow
                icon="ppl"
                label="依頼者と参加者を話す人に入れる"
                note="ページの名前（依頼者）と書き込める人を、最初から話す人にします"
                on={prop.seed === "page"}
                onChange={(on) =>
                  void updateProperty(database.id, prop.id, {
                    seed: on ? "page" : "",
                  })
                }
              />
            )}
          </>
        )}
      </div>
    );
  return (
    <div>
      <MenuTitle>シングルビューの設定</MenuTitle>
      {/* 並びはデータベースのビューの設定と同じ：レイアウトが一番上、その次に出す項目。どのページかを選ぶソースは最後 */}
      <NavRow
        icon={isChat && shownDisplay === "value" ? "chat" : DISPLAY_TILE[shownDisplay].icon}
        label="レイアウト"
        value={label(shownDisplay)}
        onClick={() => setScreen("layout")}
      />
      {rows("top")}
    </div>
  );
}

/** 一緒に出す項目。日付は残りの日数（「納期まで あと16日」）、選択・ステータスなどはタグ、ほかは「名前 値」 */
function SingleExtras({ props, page, countdown }: { props: Property[]; page: DbPage; countdown: string[] }) {
  const { members } = useNoteContext();
  return (
    <>
      {props.map((p) => {
        if (countdown.includes(p.id)) {
          const due = dueLabel(page.values[p.id]);
          // 日付が空でも消さずに「未入力」と出す（入れる場所が分かるように）
          if (!due)
            return (
              <span key={p.id} className="text-muted">
                {p.name}：未入力
              </span>
            );
          return (
            <span key={p.id} className={due.tone === "late" ? "font-bold text-warn" : due.tone === "soon" ? "font-bold" : "text-muted"}>
              {p.name}まで {due.text}
            </span>
          );
        }
        if (p.type === "title") return <b key={p.id}>{page.title || "無題"}</b>;
        const tag = p.type === "select" || p.type === "status" || p.type === "multiselect" || p.type === "stage";
        return (
          <span key={p.id} className="flex min-w-0 items-center gap-1">
            {!tag && <span className="text-xs text-muted">{p.name}</span>}
            <PropValue prop={p} value={valueOf(page, p.id)} members={members} page={page} empty={<span className="text-muted">（{p.name}）</span>} />
          </span>
        );
      })}
    </>
  );
}

export function SingleViewEmbed({ props, onChange, fill }: { props: SingleProps; onChange: (patch: Partial<SingleProps>) => void; fill?: boolean }) {
  const ctx = useNoteContext();
  const { roomId, members, locked } = ctx;
  const { dbId, pageId, propId, display } = props;
  const databases = useDatabases(roomId) ?? [];
  const thisPage = pageId === THIS_PAGE;
  // 「このページ」のときは、今のページのデータベース
  const effDbId = thisPage ? (ctx.page?.dbId ?? "") : dbId;
  const database = databases.find((d) => d.id === effDbId);
  const pages = usePages(database?.id) ?? [];
  const page = pages.find((p) => p.id === (thisPage ? ctx.page?.pageId : pageId));
  const prop = database?.props.find((p) => p.id === propId);
  const gaugeable = prop && (prop.type === "number" || prop.type === "stage" || prop.type === "formula");
  const isChat = prop && (prop.type === "chat" || prop.type === "imageChat");
  const pct = database && page && prop ? percentOf(database, page, prop.id) : null;
  const extras = database ? extraProps(database, props) : [];
  // 工程の期限・残りの日数は、出している項目ごとにオン・オフ
  const shownAll = [...(prop ? [prop] : []), ...extras];
  const stagesOn = onIds(
    props.stages,
    shownAll.filter((p) => p.type === "stage"),
  );
  const countdown = onIds(
    props.countdown,
    shownAll.filter((p) => !!database && isDateLike(database, p)),
  );
  // 見出しを出さないときは、歯車だけを右上に重ねる（読むだけのときは何も出さない）
  const headed = props.hideHead !== "1";
  const ready = !!(database && prop && (page || (thisPage && ctx.template)));
  // チャットの項目のときの、そのページのチャット（送られた画像のボタンに使う）
  const chatValue = isChat && page && prop ? page.values[prop.id] : undefined;
  const chatId = typeof chatValue === "string" ? chatValue : "";
  const message = (
    <span>
      シングルビュー：
      {locked ? "編集モードで出す項目を選んでください" : "右の歯車から出す項目を選んでください"}
    </span>
  );

  const head = (headed || !locked || !!chatId) && (
    // 歯車はいつも同じ場所に置いて、見出しの出し入れで開いた設定が閉じないようにする
    <div
      className={headed ? "mb-2 flex shrink-0 flex-wrap items-center gap-1.5 text-xs text-muted" : "absolute top-1 right-1 z-[1] flex"}
      data-block-head=""
      data-locked={locked ? "" : undefined}
    >
      {headed && (
        <span className="contents" data-block-title="">
          <Icon name={isChat ? (prop?.type === "imageChat" ? "ppl" : "chat") : "eye"} size={14} />
        </span>
      )}
      {headed &&
        (ready && database && prop ? (
          page ? (
            <Link href={`/r/${roomId}/db/${database.id}/p/${page.id}`} className="min-w-0 truncate hover:underline" data-block-title="">
              {thisPage ? prop.name : `${database.name} › ${page.title || "無題"} › ${prop.name}`}
            </Link>
          ) : (
            <span className="truncate" data-block-title="">
              このページ › {prop.name}
            </span>
          )
        ) : (
          message
        ))}
      {/* チャットの項目で書き込める人を選んでいるときだけ、誰が書き込めるかを出す */}
      {headed && isChat && prop?.allowed?.length ? (
        <span className="flex min-w-0 items-center gap-1" title="書き込める人">
          <Icon name="person" size={14} className="shrink-0" />
          <span className="truncate">{writersText(members, prop.allowed)}</span>
        </span>
      ) : null}
      {/* 右上：（チャットの項目は）送られた画像と、設定の歯車 */}
      <span className="ml-auto flex shrink-0 items-center gap-0.5" data-block-keep={chatId ? "" : undefined}>
        {chatId && <ChatSearchButton chatId={chatId} roomId={roomId} compact />}
        {chatId && <ChatImagesButton chatId={chatId} roomId={roomId} compact />}
        {chatId && <ChatNotifyButton chatId={chatId} compact />}
        {!locked && (
          <SettingsButton label="シングルビューの設定">
            <SingleViewMenu props={props} database={database} page={page} onChange={onChange} />
          </SettingsButton>
        )}
      </span>
    </div>
  );

  // チャットの項目は、チャットそのものを出す（ウィンドウでは残りの高さいっぱい、ノートでは決まった高さ）
  if (isChat) {
    return (
      <div
        className={`relative flex w-full flex-col rounded-[14px] border border-line bg-card p-3 ${fill ? "h-full" : "h-[480px]"}`}
        contentEditable={false}
        data-name="シングルビュー（チャット）"
        data-fill=""
      >
        {head}
        <div className="min-h-0 flex-1">
          {page && database && prop ? (
            <PropChatView database={database} page={page} prop={prop} />
          ) : (
            (ctx.template ? <p className="grid h-full place-items-center text-sm text-muted">ページを作ると、ここにそのページのチャットが出ます</p> : <ChatSkeleton composer={false} />)
          )}
        </div>
      </div>
    );
  }

  const shownDisplay = gaugeable ? display : "value";
  return (
    <div className={`relative w-full rounded-[14px] border border-line bg-card p-3 ${fill ? "h-full overflow-auto" : ""}`} contentEditable={false} data-name="シングルビュー">
      {head}
      {/* 見出しを出さず、歯車を右上に重ねているときは、右に歯車の分の空きを作る */}
      <div className={!headed && !locked ? "pr-6" : ""}>
        {!headed && !ready && <p className="text-xs text-muted">{message}</p>}
        {database && prop && !page && thisPage && ctx.template && (
          <p className="text-sm text-muted">
            （ページの{prop.name}
            {extras.map((p) => `・${p.name}`).join("")}）
          </p>
        )}
        {database && page && prop && (
          // 「進み具合と工程」と同じ並び：ゲージ（または値）の横に一緒に出す項目、その下に工程の期限
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {shownDisplay === "circle" ? (
                <div className="flex items-center gap-2">
                  <CircleGauge value={pct ?? 0} size={96} label={prop.name} />
                  {prop.type === "stage" && <StageButton prop={prop} page={page} />}
                </div>
              ) : shownDisplay === "line" ? (
                <div className="flex min-w-48 flex-1 items-center gap-2">
                  <Gauge value={pct ?? 0} />
                  {prop.type === "stage" ? <StageButton prop={prop} page={page} /> : <span className="shrink-0 px-2 font-bold">{pct ?? 0}%</span>}
                </div>
              ) : prop.type === "title" ? (
                <span className="text-[1.6em] font-bold">{page.title || "無題"}</span>
              ) : countdown.includes(prop.id) ? (
                <SingleExtras props={[prop]} page={page} countdown={countdown} />
              ) : (
                <span className="text-[1.3em]">
                  <PropValue prop={prop} value={valueOf(page, prop.id)} members={members} page={page} empty={<span className="text-muted">（空）</span>} />
                </span>
              )}
              <SingleExtras props={extras} page={page} countdown={countdown} />
            </div>
            {/* 期限を出す工程の項目ごとに、工程の期限を並べる */}
            {shownAll
              .filter((p) => p.type === "stage" && stagesOn.includes(p.id))
              .map((p) => (
                <StagePills key={p.id} stages={stageDatesOf(p, page)} onPick={(name) => updatePageValue(page.id, p.id, name)} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- オールビュー：データベースのビューを埋め込む ----

/** オールビューの高さ（小・中・大）。ビューの中身をこの高さで切る */
const SIZE_HEIGHT = { s: 230, m: 420, l: 680 } as const;

/**
 * 決めた高さ（maxHeight）、またはウィンドウで残っている高さでビューを切って出す。入りきらないときは、
 * 一番下の文字の下半分を薄く隠して、下向きの三角の「すべて見る」を出す。押すと、ポップアップで全部を見られる。
 * height のときは、中身が少なくてもその高さにする（タイムラインは、枠をその高さまで伸ばす）。
 * fill（ウィンドウ）のときは、区画の高さいっぱいにする
 */
function ClipView({
  maxHeight,
  height,
  fill,
  title,
  full,
  children,
}: {
  maxHeight?: number;
  height?: number;
  fill?: boolean;
  title: string;
  full: React.ReactNode;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(false);
  // 中身の高さが変わるたびに、入りきっているかを見る（最初の1回も ResizeObserver が知らせる）
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setOver(el.scrollHeight > el.clientHeight + 2));
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  return (
    // ウィンドウでは、区画の高さで切る（縦のスクロールは出さない）
    <div className={`relative ${fill ? "flex min-h-0 grow flex-col" : ""}`}>
      <div
        ref={box}
        // 高さが決まっているときは、中のビューを高さいっぱいに伸ばす（多いときは縮めずにはみ出させて、「すべて見る」を出す）
        className={`overflow-hidden ${height || fill ? "flex flex-col *:shrink-0 *:grow" : ""} ${fill ? "min-h-0 grow basis-0" : ""}`}
        style={{
          maxHeight,
          height,
          // 入りきらないときは、下のほうを薄くして、一番下の文字の下半分を隠す
          maskImage: over ? "linear-gradient(to bottom, black calc(100% - 36px), transparent calc(100% - 4px))" : undefined,
        }}
      >
        {children}
      </div>
      {over && (
        <button
          onClick={() => setOpen(true)}
          className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-card px-3 py-0.5 text-xs text-muted shadow-sm hover:text-ink"
          title="ポップアップで全部を見る"
        >
          <Icon name="rt" size={14} className="rotate-90" />
          すべて見る
        </button>
      )}
      {open && (
        <PopupDialog title={title} onClose={() => setOpen(false)}>
          {full}
        </PopupDialog>
      )}
    </div>
  );
}

/** オールビューのブロックが持つビューの並び（JSON）を読む */
const parseViews = (s: string): BlockView[] => {
  try {
    const v: unknown = JSON.parse(s || "[]");
    return Array.isArray(v) ? (v as BlockView[]) : [];
  } catch {
    return [];
  }
};

/** ビューをまだ持っていないときの、はじめのビュー（表） */
const FIRST_VIEW: BlockView = {
  id: "first",
  name: "表",
  type: "table",
  filters: [],
  sort: null,
  options: {},
};

/**
 * オールビュー（Notion のデータベースのリンクされたビュー）：データベース（ソース）のページを、ブロックが持つビューで出す。
 * ビューは何個でも持てて、データベースの画面と同じタブで切り替える。ビューの設定はデータベースのビューの設定と同じで、
 * 中身はこのブロックに保存する（データベースのビューは変わらない）。「＋」からは、データベースのビューをコピーして足すこともできる。
 * hideHead が "1" のときは、タイトルの行（ビューの名前・タブ・データベース）を出さずに、縦の場所をビューに使う
 */
export function DbViewEmbed({
  dbId,
  views,
  active,
  hideHead,
  onChange,
  fill,
}: {
  dbId: string;
  views: string;
  active: string;
  hideHead: string;
  onChange: (patch: { dbId?: string; views?: string; active?: string; hideHead?: string }) => void;
  fill?: boolean;
}) {
  const { roomId, members, userId, locked } = useNoteContext();
  const databases = useDatabases(roomId) ?? [];
  const database = databases.find((d) => d.id === dbId) ?? databases[0];
  const dbViews = useViews(database?.id) ?? [];
  const pages = usePages(database?.id);
  const events = useEvents(roomId);
  const addPop = usePopover();
  const stored = parseViews(views);
  const list = stored.length ? stored : [FIRST_VIEW];
  const cur = list.find((v) => v.id === active) ?? list[0];
  const view: DbView | undefined = database && {
    ...cur,
    dbId: database.id,
    order: 0,
  };
  const saveList = (next: BlockView[], activeId = cur.id) => onChange({ views: JSON.stringify(next), active: activeId });
  // ビューを直したときは、このブロックのビューの並びに書き戻す（固定したビューは、固定を外すときだけ）
  const save = (v: DbView) =>
    cur.options.locked && v.options.locked
      ? undefined
      : saveList(
      list.map((x) =>
        x.id === v.id
          ? {
              id: v.id,
              name: v.name,
              type: v.type,
              filters: v.filters,
              filterMode: v.filterMode,
              sort: v.sort,
              sorts: v.sorts,
              options: v.options,
            }
          : x,
      ),
    );
  const add = (v: BlockView) => {
    addPop.close();
    saveList([...list, v], v.id);
  };
  // 高さ（小・中・大）。ノートだけで使う（ウィンドウでは、高さは区画で決まる）。決めていなければ中身に合わせる。
  // カレンダーは日付を切らずに、1日に出す件数で決める（CalendarView）
  const size = fill || cur.type === "calendar" ? undefined : cur.options.size;
  // タイムラインは、件数が少なくても決めた高さ（ウィンドウでは区画の高さ）にする（枠と目盛りの線を下まで伸ばす）。ほかは、その高さまで
  const fixed = cur.type === "timeline" && (!!size || !!fill);
  // ビューが1つだけのときは、タブを出さない
  const tabbed = list.length > 1;
  // タイトルを出さないときは、歯車だけを、カーソルを合わせたときに右上に重ねる（読むだけのときは何も出さない）
  const headed = hideHead !== "1";
  const addButton = !locked && (
    <button
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-muted hover:bg-tint ${tabbed ? "mb-0.5 self-center" : ""}`}
      aria-label="ビューを追加"
      title="ビューを追加"
      onClick={addPop.toggle}
    >
      <Icon name="add" size={16} />
    </button>
  );

  return (
    <ViewSaveContext.Provider value={save}>
      {/* 外枠は付けない（ビューのタブとビューだけ。Notion のリンクされたビューと同じ） */}
      {/* ウィンドウでは区画（data-fill）：残りの高さを割合で分け合い、その高さいっぱいに出す。入りきらない分は「すべて見る」から */}
      <div
        className={`group/ov relative w-full py-1 ${fill ? "flex h-full flex-col overflow-hidden" : ""} ${!headed && !locked ? "[&_[data-cal-head]]:pr-8" : ""}`}
        data-fill={fill ? "" : undefined}
        contentEditable={false}
        data-name="オールビュー"
      >
        {/* ビューが2つ以上なら、データベースの画面と同じタブの並び（下に線）。1つだけならタブは出さず、ビューの名前だけ。
            歯車はいつも同じ場所に置いて、タイトルの出し入れで開いた設定が閉じないようにする */}
        {(headed || !locked) && (
          <div
            className={
              headed
                ? `mb-1 flex shrink-0 flex-wrap gap-x-2 ${tabbed ? "items-end border-b border-line" : "items-center"}`
                : "absolute top-1.5 right-1 z-[3] flex rounded-[8px] bg-card opacity-0 shadow-sm group-hover/ov:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100"
            }
            data-block-head=""
            data-locked={locked ? "" : undefined}
          >
            {!headed ? null : tabbed ? (
              <TabStrip
                items={list.map((v) => ({
                  id: v.id,
                  title: v.name,
                  content: (
                    <>
                      <Icon name={VIEW_TYPES[v.type].icon} size={14} className="shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-left">{v.name}</span>
                    </>
                  ),
                }))}
                active={cur.id}
                onSelect={(id) => id !== cur.id && saveList(list, id)}
                label="ビュー"
                unit="ビュー"
                className="min-w-0 flex-1 pt-1 pl-1"
                after={addButton}
              />
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-sm">
                <Icon name={VIEW_TYPES[cur.type].icon} size={16} className="shrink-0 text-muted" />
                <b className="min-w-0 truncate">{cur.name}</b>
                {addButton}
              </span>
            )}
            {/* ソースのデータベースを開く。歯車はその右 */}
            <span className="flex shrink-0 items-center gap-1 py-0.5 text-sm">
              {headed && database && (
                <Link
                  href={`/r/${roomId}/db/${database.id}`}
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted hover:bg-tint hover:text-ink"
                  title="データベースを開く"
                >
                  <IconMark icon={database.icon} fallback={<Icon name="db" size={14} />} />
                  {database.name}
                  <Icon name="open" size={12} />
                </Link>
              )}
              {!locked && database && view && (
                <SettingsButton label="オールビューの設定" width={320}>
                  {(close) => (
                    <ViewSettingsMenu
                      key={view.id}
                      database={database}
                      view={view}
                      members={members}
                      onClose={close}
                      block={{
                        databases,
                        inWindow: fill,
                        hideHead: !headed,
                        onHideHead: (hide) => onChange({ hideHead: hide ? "1" : "" }),
                        // データベースを変えたら、ビューは最初から（項目がデータベースごとに違うので）
                        onPickDb: (id) => onChange({ dbId: id, views: "", active: "" }),
                        onDuplicate: () => {
                          const copy = {
                            ...copyView(cur),
                            name: `${cur.name}のコピー`,
                          };
                          saveList([...list, copy], copy.id);
                        },
                        onDelete:
                          list.length > 1
                            ? () => {
                                const rest = list.filter((x) => x.id !== cur.id);
                                saveList(rest, rest[0].id);
                              }
                            : undefined,
                      }}
                    />
                  )}
                </SettingsButton>
              )}
            </span>
          </div>
        )}
        {database && view && pages && events ? (
          // ウィンドウのカレンダーは、切らずにマスの高さを区画に合わせる（日付は減らさない）
          fill && view.type === "calendar" ? (
            <ViewRenderer key={view.id} database={database} view={view} allPages={pages} events={events} members={members} userId={userId} compact fit />
          ) : // サイズを決めたらその高さで、ウィンドウでは区画の高さで切る。ノートで自動なら切らない
          size || fill ? (
            <ClipView
              key={view.id}
              maxHeight={size && !fixed ? SIZE_HEIGHT[size] : undefined}
              height={size && fixed ? SIZE_HEIGHT[size] : undefined}
              fill={fill}
              title={view.name}
              full={<ViewRenderer database={database} view={view} allPages={pages} events={events} members={members} userId={userId} />}
            >
              <ViewRenderer database={database} view={view} allPages={pages} events={events} members={members} userId={userId} compact fit={fixed} />
            </ClipView>
          ) : (
            <ViewRenderer key={view.id} database={database} view={view} allPages={pages} events={events} members={members} userId={userId} compact />
          )
        ) : (
          <ViewSkeleton type={view?.type} rows={4} />
        )}
        {addPop.anchor && (
          <Popover anchor={addPop.anchor} onClose={addPop.close} width={280} label="ビューを追加">
            <MenuLabel>新しいビュー</MenuLabel>
            {(Object.keys(VIEW_TYPES) as ViewType[]).map((t) => (
              <MenuItem
                key={t}
                icon={<Icon name={VIEW_TYPES[t].icon} size={16} />}
                onClick={() =>
                  add(
                    copyView({
                      name: VIEW_TYPES[t].label,
                      type: t,
                      filters: [],
                      sort: null,
                      options: t === "calendar" || t === "timeline" ? { stages: true } : {},
                    }),
                  )
                }
              >
                <span className="block" title={VIEW_TYPES[t].note}>
                  {VIEW_TYPES[t].label}
                </span>
              </MenuItem>
            ))}
            {dbViews.length > 0 && (
              <>
                <MenuDivider />
                <MenuLabel>データベースのビューをコピー</MenuLabel>
                {dbViews.map((v) => (
                  <MenuItem key={v.id} icon={<Icon name={VIEW_TYPES[v.type].icon} size={16} />} onClick={() => add(copyView(v))}>
                    {v.name}
                  </MenuItem>
                ))}
              </>
            )}
          </Popover>
        )}
      </div>
    </ViewSaveContext.Provider>
  );
}

// ---- ブロックの中身：ノートのブロックとウィンドウの部品は、どちらもこれで描く ----

/**
 * 文章以外のブロック1つの中身。props はノートのブロックの props と同じ形。
 * fill はウィンドウの部品として、枠いっぱいに広げるとき。onPickMany はノートで画像を2枚以上選んだとき
 */
export function BlockBody({
  type,
  props,
  onChange,
  fill,
  onPickMany,
  blockId,
}: {
  type: EmbedKind;
  props: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
  fill?: boolean;
  onPickMany?: (ids: string[]) => void;
  /** ブロックの ID（テンプレートと繋いだチャンネルで、チャットのブロックごとのチャットを探す） */
  blockId?: string;
}) {
  const { windowMode, linkedChats, page: pageScope } = useNoteContext();
  fill = fill ?? windowMode;
  switch (type) {
    case "mediaImage":
      return (
        <MediaImageView
          mediaId={props.mediaId ?? ""}
          width={(props.width as Width) || "m"}
          fill={fill}
          onWidth={fill ? undefined : (width) => onChange({ width })}
          onPick={(ids) => {
            onChange({ mediaId: ids[0] });
            if (ids.length > 1) onPickMany?.(ids.slice(1));
          }}
        />
      );
    case "chatBlock":
    case "imageChatBlock":
      // データベースのページ（とそのテンプレート・メモ）では、データベースのチャットの項目と繋ぐ。前からチャットを持っているブロックは、そのまま
      if (pageScope?.dbId && !props.chatId)
        return <DbChatBlock kind={type === "chatBlock" ? "normal" : "image"} propId={props.propId ?? ""} onChange={onChange} fill={fill} />;
      return (
        <ChatBlockView
          // テンプレートと繋いだチャンネルでは、このチャンネル用のチャット（テンプレートには書かない）
          chatId={linkedChats && blockId ? (linkedChats.get(blockId) ?? "") : (props.chatId ?? "")}
          kind={type === "chatBlock" ? "normal" : "image"}
          fill={fill}
          onCreated={(chatId) => (linkedChats && blockId ? linkedChats.set(blockId, chatId) : onChange({ chatId }))}
          seed={props.seed}
          onSeed={type === "imageChatBlock" ? (seed) => onChange({ seed }) : undefined}
        />
      );
    case "singleView":
      return (
        <SingleViewEmbed
          props={{
            dbId: props.dbId ?? "",
            pageId: props.pageId ?? "",
            propId: props.propId ?? "",
            display: (props.display as SingleDisplay) || "value",
            visible: props.visible ?? "[]",
            stages: props.stages ?? "",
            countdown: props.countdown ?? "",
            hideHead: props.hideHead ?? "",
          }}
          onChange={(p) => onChange(p as Record<string, string>)}
          fill={fill}
        />
      );
    case "dbView":
      return (
        <DbViewEmbed
          dbId={props.dbId ?? ""}
          views={props.views ?? ""}
          active={props.active ?? ""}
          hideHead={props.hideHead ?? ""}
          onChange={(p) => onChange(p as Record<string, string>)}
          fill={fill}
        />
      );
    case "todoBlock":
      return <TodoBlockView fill={fill} source={props.source ?? ""} onChange={(p) => onChange(p as Record<string, string>)} />;
    case "addButton":
      return (
        <AddButtonView
          props={{
            dbId: props.dbId ?? "",
            templateId: props.templateId ?? "",
            label: props.label ?? "",
            align: props.align ?? "",
          }}
          onChange={(p) => onChange(p as Record<string, string>)}
        />
      );
    case "calendarBlock":
      return (
        <CalendarBlockView
          props={{
            calendarId: props.calendarId ?? "",
            own: props.own ?? "1",
            room: props.room ?? "",
            dbs: props.dbs ?? "[]",
            range: props.range ?? "month",
            weekStart: props.weekStart ?? "",
            wrap: props.wrap ?? "",
          }}
          onChange={(p) => onChange(p as Record<string, string>)}
          fill={fill}
        />
      );
    case "linkButton":
      return (
        <LinkButtonView
          props={{
            label: props.label ?? "",
            kind: props.kind ?? "",
            noteId: props.noteId ?? "",
            dbId: props.dbId ?? "",
            pageId: props.pageId ?? THIS_PAGE,
            propId: props.propId ?? "",
            align: props.align ?? "",
          }}
          onChange={(p) => onChange(p as Record<string, string>)}
        />
      );
    default: {
      // ページのブロック。ノートの中では枠を付け、チャットは高さを決めておく
      const body = <PageBlockBody type={type} props={props} onChange={onChange} />;
      if (fill) {
        // ウィンドウ：ページのチャットは残りの高さいっぱい
        if (type === "pageChat")
          return (
            <div className="h-full w-full overflow-hidden rounded-[14px] border border-line bg-card" data-fill="">
              {body}
            </div>
          );
        // ページの項目は中身の高さ。入りきらないときだけ縮めて、中をスクロールする（data-shrink）
        if (type === "pageProps")
          return (
            <div className="w-full overflow-x-hidden overflow-y-auto rounded-[14px] border border-line bg-card" data-shrink="">
              {body}
            </div>
          );
        return <div className="w-full rounded-[14px] border border-line bg-card">{body}</div>;
      }
      return <div className={`w-full rounded-[14px] border border-line bg-card ${type === "pageChat" ? "h-[460px]" : ""}`}>{body}</div>;
    }
  }
}
