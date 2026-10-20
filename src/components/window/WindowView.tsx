"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { useEditMode } from "./editMode";
import { NoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { TopBarActions } from "@/components/TopBarSlot";
import { AreaResizer } from "./AreaResizer";
import { useMembers } from "@/lib/local/rooms";
import { useCurrentUser } from "@/lib/local/session";
import { saveWindowBlocks, saveWindowHeights, useWindowPage } from "@/lib/local/windows";
import { setLinkedChat } from "@/lib/local/channelTemplates";
import { DocSkeleton } from "@/components/Skeleton";

// エディタはブラウザでしか動かないので、サーバーでは描画しない
const BlockEditor = dynamic(() => import("@/components/note/BlockEditor").then((m) => m.BlockEditor), {
  ssr: false,
  loading: () => <DocSkeleton title={false} className="p-4" />,
});

/** 区画の高さの割合を、ブロックごとに当てる（globals.css の --grow） */
const areaStyle = (grows: Record<string, number>) =>
  Object.entries(grows)
    .filter(([id, g]) => /^[\w-]+$/.test(id) && g > 0)
    .map(([id, g]) => `.doc-window [data-id="${id}"]{--grow:${g}}`)
    .join("\n");

/**
 * ウィンドウ：ノートと同じブロックを、画面の大きさに固定して並べるページ。
 * 高さは区画で決まる：文章などは中身の高さで、チャット・オールビューなど（区画）は、残りの高さを割合で分け合う。
 * ふだんは読むだけ（チャットで話す・ビューを見る・データを直すことはできる）。サイドバーの右クリック「編集」で開いたときだけ、
 * ノートと同じように「＋」「⋮⋮」で並べ方や文章を変えられる。
 */
export function WindowView({ roomId, windowId }: { roomId: string; windowId: string }) {
  const win = useWindowPage(windowId);
  // ソース（テンプレート）と繋いでいれば、テンプレートの中身を出す
  const source = useWindowPage(win?.sourceId ?? undefined);
  const me = useCurrentUser();
  const members = useMembers(roomId);
  // 編集モードは、サイドバーの右クリック「編集」で入る（URL の ?edit=1）。編集中だけ右上に「完了」
  const { editing, finish } = useEditMode();
  // 境目の線を動かしているあいだの割合（離したら保存する）
  const [dragGrows, setDragGrows] = useState<Record<string, number> | null>(null);

  if (win === undefined || (win?.sourceId && source === undefined) || !me || !members) return <DocSkeleton title={false} />;
  if (!win || win.roomId !== roomId) {
    return (
      <p className="text-muted">
        ウィンドウが見つかりません。<Link href={`/r/${roomId}`} className="underline">ルームの最初へ</Link>
      </p>
    );
  }

  // テンプレートと繋いでいるときは、中身（並べ方・高さ）はテンプレートのもの。編集するとテンプレートが変わる。チャットはこのウィンドウ用
  const linked = !!win.sourceId && !!source;
  const content = linked && source ? source : win;
  const linkedChats = linked ? { get: (blockId: string) => win.chatMap?.[blockId], set: (blockId: string, chatId: string) => void setLinkedChat("window", win.id, blockId, chatId) } : undefined;

  return (
    <NoteContext.Provider value={{ roomId, userId: me.id, members, owner: `window:${win.id}`, locked: !editing, windowMode: true, template: win.template, linkedChats }}>
      {/* 名前とアイコンは上のバーに出る。編集中だけ、上のバーの右に「完了」 */}
      {editing && (
        <TopBarActions>
          {linked && <span className="text-xs text-warn">テンプレートを編集しています（使っているところ全部に反映されます）</span>}
          <button onClick={finish} className="btn h-7 min-h-0 px-3 text-sm" data-name="編集を終える">
            <Icon name="ok" size={14} />
            完了
          </button>
        </TopBarActions>
      )}
      {/* メイン画面の左右・上下の余白を打ち消して、画面の端まで使う */}
      <div data-name="ウィンドウ画面" className="-mx-[clamp(16px,4vw,40px)] -mt-4 -mb-7 flex h-[calc(100%+2.75rem)] flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          <style>{areaStyle(dragGrows ?? content.heights ?? {})}</style>
          <div className="h-full">
            <BlockEditor
              key={content.id}
              id={content.id}
              blocks={content.blocks ?? []}
              roomId={roomId}
              userId={me.id}
              editable={editing}
              mode="window"
              onSave={(blocks) => saveWindowBlocks(content.id, blocks)}
            />
          </div>
          {/* 編集中は、上下に並んだ区画のあいだに線を出す。つかんで動かすと高さの割合が変わる */}
          {editing && (
            <AreaResizer
              grows={dragGrows ?? content.heights ?? {}}
              onChange={setDragGrows}
              onDone={async (g) => {
                await saveWindowHeights(content.id, g);
                setDragGrows(null);
              }}
            />
          )}
        </div>
      </div>
    </NoteContext.Provider>
  );
}
