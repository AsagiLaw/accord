"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PropIcon } from "@/components/db/meta";
import { PropInput } from "@/components/db/PropInput";
import { NoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { TopBarActions } from "@/components/TopBarSlot";
import { PopupDialog } from "@/components/ui/Dialog";
import { choose } from "@/components/ui/overlay";
import type { Database, PageTemplate } from "@/lib/local/db";
import { useDatabase, usePages } from "@/lib/local/requests";
import { useMembers, type MemberWithProfile } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { setTemplateValue, updateTemplate } from "@/lib/local/templates";

// 本文のエディタはブラウザでしか動かないので、サーバーでは描画しない
const BlockEditor = dynamic(() => import("@/components/note/BlockEditor").then((m) => m.BlockEditor), {
  ssr: false,
  loading: () => <p className="loading p-4 text-muted">読み込み中…</p>,
});

/**
 * ページのテンプレートの本文を直す画面。実際のページ（ウィンドウ型ならウィンドウの編集）と同じ広さにするため、
 * 本文のほかは何も置かない。名前は上のバーに出て、初期値（はじめから入れる値）は上のバーの「初期値」からポップアップで直す。
 * 既定・名前・複製・削除は、データベースの「追加」の横の「▼」のメニューで、テンプレートを右クリックして行う。
 * 本文は、上のバーの「保存」を押すまでテンプレートに入れない（「キャンセル」で捨てる）。保存していないまま別の画面へ移ろうとすると、保存するかを聞く
 */
export default function TemplateScreen() {
  const { roomId, dbId, templateId } = useParams<{ roomId: string; dbId: string; templateId: string }>();
  const database = useDatabase(dbId);
  const me = useCurrentUser();
  const members = useMembers(roomId);
  const [valuesOpen, setValuesOpen] = useState(false);
  const router = useRouter();
  // 直したまだ保存していない本文（エディタが入力の止まったときに渡してくる）
  const draft = useRef<unknown[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const dbHref = `/r/${roomId}/db/${dbId}`;
  const saveDraft = async () => {
    if (draft.current && database) await updateTemplate(database.id, templateId, { blocks: draft.current });
    draft.current = null;
    setDirty(false);
  };
  // 保存せずに別の画面へ移ろうとしたら聞く：リンク（サイドバーなど）を押したときと、ブラウザのタブを閉じる・読み込み直すとき
  const saveRef = useRef(saveDraft);
  useEffect(() => {
    saveRef.current = saveDraft;
  });
  useEffect(() => {
    if (!dirty) return;
    const onClick = async (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === "_blank") return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      const k = await choose("テンプレートを保存しますか？", [
        { label: "保存して移動", detail: "直した本文をテンプレートに入れてから移ります" },
        { label: "保存せずに移動", detail: "直した本文は捨てます" },
      ]);
      if (k === null) return;
      if (k === 0) await saveRef.current();
      else {
        draft.current = null;
        setDirty(false);
      }
      router.push(url.pathname + url.search);
    };
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty, router]);

  if (database === undefined || !me || !members) return <p className="loading text-muted">読み込み中…</p>;
  const t = database?.templates?.find((x) => x.id === templateId);
  if (!database || !t) {
    return (
      <p className="text-muted">
        テンプレートが見つかりません。<Link href={dbHref} className="underline">データベースへ</Link>
      </p>
    );
  }
  const filled = valueProps(database).filter((p) => !blank(t.values[p.id])).length;
  // エディタからは、直すたびに今の本文を受け取るだけ（保存は「保存」を押したとき）
  const edit = (blocks: unknown[]) => {
    draft.current = blocks;
    setDirty(true);
  };

  return (
    <NoteContext.Provider value={{ roomId, userId: me.id, members, owner: `template:${t.id}`, template: true, page: { dbId }, windowMode: t.kind === "window" }}>
      {/* 上のバーの右：繋がっているページの数と、初期値 */}
      <TopBarActions>
        {t.kind === "window" && <LinkedCount dbId={database.id} templateId={t.id} />}
        <button className="btn-sub h-7 min-h-0 px-3 text-sm" onClick={() => setValuesOpen(true)} title="このテンプレートで作ったときに、最初から入る値">
          <Icon name="tag" size={14} />
          初期値
          {filled > 0 && <span className="rounded-full bg-tint px-1.5 text-xs text-muted">{filled}</span>}
        </button>
        {dirty && <span className="text-xs text-muted">保存していない変更があります</span>}
        {/* キャンセル：直した本文を捨てて、データベースの画面に戻る */}
        <button
          className="btn-sub h-7 min-h-0 px-3 text-sm"
          onClick={() => {
            draft.current = null;
            setDirty(false);
            router.push(dbHref);
          }}
          data-name="テンプレートの編集をやめる"
        >
          キャンセル
        </button>
        <button className="btn h-7 min-h-0 px-3 text-sm" disabled={!dirty} onClick={() => void saveDraft()} data-name="テンプレートを保存">
          <Icon name="ok" size={14} />
          保存
        </button>
      </TopBarActions>
      {t.kind === "window" ? (
        // ウィンドウ型：実際のページの編集と同じく、メイン画面の余白を打ち消して、画面の端まで使う
        <div data-name="テンプレートの本文（ウィンドウ型）" className="-mx-[clamp(16px,4vw,40px)] -mt-4 -mb-7 flex h-[calc(100%+2.75rem)] flex-col overflow-hidden">
          <div className="min-h-0 flex-1">
            <BlockEditor id={t.id} blocks={t.blocks ?? []} roomId={roomId} userId={me.id} editable mode="window" onSave={() => undefined} onEdit={edit} />
          </div>
        </div>
      ) : (
        <div data-name="テンプレートの本文（ノート型）" className="min-h-full">
          <BlockEditor id={t.id} blocks={t.blocks ?? []} roomId={roomId} userId={me.id} editable onSave={() => undefined} onEdit={edit} />
        </div>
      )}
      {valuesOpen && <ValuesDialog database={database} template={t} members={members} userId={me.id} onClose={() => setValuesOpen(false)} />}
    </NoteContext.Provider>
  );
}

/** 初期値を入れられる項目（タイトル・自動の日時・チャットは除く） */
const valueProps = (database: Database) =>
  database.props.filter((p) => p.type !== "title" && p.type !== "created" && p.type !== "edited" && p.type !== "chat" && p.type !== "imageChat" && p.type !== "page");
const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

/** 初期値（このテンプレートで作ったときに、最初から入る値）を直すポップアップ */
function ValuesDialog({ database, template, members, userId, onClose }: { database: Database; template: PageTemplate; members: MemberWithProfile[]; userId: string; onClose: () => void }) {
  const label = "ページ";
  return (
    <PopupDialog title={`初期値：テンプレート「${template.name}」`} onClose={onClose} width="max-w-2xl">
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2" title={`このテンプレートで${label}を作ったときに、最初から入る値です。空のままの項目は、ふつうの追加と同じです`}>
        {valueProps(database).map((p) => (
          <label key={p.id} className="block" htmlFor={`tv-${p.id}`}>
            <span className="mb-0.5 flex items-center gap-1 text-xs text-muted">
              <PropIcon type={p.type} size={13} />
              {p.name}
            </span>
            <PropInput
              id={`tv-${p.id}`}
              database={database}
              prop={p}
              value={template.values[p.id]}
              onChange={(v) => setTemplateValue(database.id, template.id, p.id, v)}
              members={members}
              userId={userId}
              page={{ values: template.values }}
            />
          </label>
        ))}
      </div>
    </PopupDialog>
  );
}

/** このテンプレートと繋いでいるページの数（直すと、そのページ全部の本文が変わる） */
function LinkedCount({ dbId, templateId }: { dbId: string; templateId: string }) {
  const n = (usePages(dbId) ?? []).filter((p) => p.sourceId === templateId).length;
  if (!n) return null;
  return (
    <span className="flex items-center gap-1 rounded-full bg-tint px-2 py-0.5 text-xs text-warn" title="直すと、繋いでいるページ全部の本文が変わります">
      <Icon name="link" size={12} />
      {n}個のページと繋がっています
    </span>
  );
}
