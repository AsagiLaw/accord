"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { IconMark } from "@/components/IconMark";
import { IconPicker } from "@/components/IconPicker";
import { MediaPicker } from "@/components/MediaPicker";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover } from "@/components/ui/Popover";
import { setChannelIcon } from "@/lib/local/channels";
import type { Note, NoteCover } from "@/lib/local/db";
import { useMediaByIds } from "@/lib/local/media";
import { renameNote, setNoteCover } from "@/lib/local/notes";
import { useBlobUrl } from "@/lib/media/blob-url";

/**
 * Notion のページの頭：カバー（メディアの画像かギャラリーの色）・大きいアイコン・大きいタイトル。
 * アイコン・カバーが無いときは、頭にカーソルを乗せると「アイコンを追加」「カバー画像を追加」が出る。
 * タイトルで Enter を押すと本文のいちばん上に新しい行を作って移り、↓ で本文へ移る（onEnter）
 */
export function NoteHeader({
  note,
  roomId,
  userId,
  editable,
  onEnter,
  titleRef,
}: {
  note: Note;
  roomId: string;
  userId: string;
  editable: boolean;
  onEnter: (mode: "new" | "first") => void;
  titleRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const iconPop = usePopover();
  const setIcon = (icon: string | undefined) => void setChannelIcon({ kind: "note", id: note.id }, icon);
  const ids = Object.keys(COVER_GALLERY);
  return (
    <div data-name="ノートの頭" className={`group/head ${note.cover ? "" : "pt-14 max-md:pt-8"}`}>
      {note.cover && <Cover note={note} cover={note.cover} roomId={roomId} userId={userId} editable={editable} />}
      <div className="note-head-inner">
        {note.icon && (
          <button
            type="button"
            disabled={!editable}
            onClick={iconPop.toggle}
            aria-label="アイコンを変える"
            title={editable ? "アイコンを変える" : undefined}
            className={`note-head-icon ${note.cover ? "-mt-[42px] max-md:-mt-[34px]" : ""}`}
          >
            <IconMark icon={note.icon} />
          </button>
        )}
        {iconPop.anchor && <IconPicker anchor={iconPop.anchor} roomId={roomId} hasIcon={!!note.icon} removeLabel="アイコンを外す" onPick={setIcon} onClose={iconPop.close} />}
        {/* アイコン・カバーを足すボタン。いつもは隠し、頭にカーソルを乗せたときに出す（場所は取っておき、出ても文字が動かないように） */}
        <div className="flex h-8 items-end gap-0.5 pb-1 opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {editable && !note.icon && (
            <HeadButton icon="smile" onClick={iconPop.toggle}>
              アイコンを追加
            </HeadButton>
          )}
          {editable && !note.cover && (
            // Notion と同じく、まずギャラリーの色を1つ付ける（あとで「カバーを変更」から選び直せる）
            <HeadButton icon="img" onClick={() => void setNoteCover(note.id, { gradient: ids[Math.floor(Math.random() * ids.length)] })}>
              カバー画像を追加
            </HeadButton>
          )}
        </div>
        <Title note={note} editable={editable} onEnter={onEnter} titleRef={titleRef} />
      </div>
    </div>
  );
}

function HeadButton({ icon, children, onClick }: { icon: IconName; children: React.ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-sm text-muted hover:bg-tint hover:text-ink">
      <Icon name={icon} size={16} />
      {children}
    </button>
  );
}

/** タイトル。打つそばから少し待って保存する。空にしたときは、元の名前に戻す */
function Title({ note, editable, onEnter, titleRef }: { note: Note; editable: boolean; onEnter: (mode: "new" | "first") => void; titleRef: React.RefObject<HTMLTextAreaElement | null> }) {
  // 書いている間の文字（ほかの人が名前を変えても、書いている途中は上書きしない）
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const value = draft ?? note.title;
  const save = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const t = v.trim();
    if (t && t !== note.title) void renameNote(note.id, t);
  };
  // 中身に合わせて高さを変える（折り返したタイトルも全部見せる）
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, titleRef]);
  // 「/ページ」で作ったばかりの子のページ（名前が空）は、すぐ名前を書けるようにする（Notion と同じ）
  useEffect(() => {
    if (editable && !note.title && note.parentId && Date.now() - note.createdAt < 10_000) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いたときに1回だけ
  }, [note.id]);
  return (
    <textarea
      ref={titleRef}
      rows={1}
      value={value}
      readOnly={!editable}
      placeholder="無題"
      aria-label="ノートの名前"
      spellCheck={false}
      className="note-title"
      onFocus={() => setDraft(note.title)}
      onChange={(e) => {
        // タイトルは1行（改行は貼り付けても空白にする）
        const v = e.target.value.replace(/\r?\n/g, " ");
        setDraft(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => save(v), 500);
      }}
      onBlur={() => {
        if (draft !== null) save(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        // 日本語の変換を決めるための Enter では動かない
        if (e.nativeEvent.isComposing) return;
        const el = e.currentTarget;
        if (e.key === "Enter") {
          e.preventDefault();
          save(el.value);
          onEnter("new");
        } else if (e.key === "ArrowDown" && el.selectionStart === el.value.length) {
          e.preventDefault();
          onEnter("first");
        } else if (e.key === "Escape") el.blur();
      }}
    />
  );
}

// ---- カバー ----

/** ギャラリーの色（Notion のギャラリーと同じく、写真が無くても付けられるもの）。ID はノートに保存する */
export const COVER_GALLERY: Record<string, { label: string; css: string }> = {
  dawn: { label: "朝焼け", css: "linear-gradient(135deg, #f6d365 0%, #fda085 100%)" },
  peach: { label: "ピーチ", css: "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)" },
  lilac: { label: "ライラック", css: "linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)" },
  sky: { label: "空", css: "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)" },
  mint: { label: "ミント", css: "linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)" },
  lime: { label: "若葉", css: "linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)" },
  teal: { label: "ティール", css: "linear-gradient(135deg, #00757f 0%, #4fc3c9 100%)" },
  indigo: { label: "インディゴ", css: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
  ocean: { label: "深い海", css: "linear-gradient(135deg, #0f2027 0%, #2c5364 100%)" },
  night: { label: "夜", css: "linear-gradient(135deg, #232526 0%, #414345 100%)" },
  red: { label: "赤", css: "#e16259" },
  yellow: { label: "黄", css: "#e9b949" },
  blue: { label: "青", css: "#4a8fd9" },
  beige: { label: "ベージュ", css: "#e8dcc6" },
};

/**
 * カバー。カーソルを乗せると右下に「カバーを変更」「位置を調整」（画像のとき）が出る。
 * 位置を調整：画像を上下にドラッグして、見せる高さを決める（「保存」で決め、「キャンセル」で戻す）
 */
function Cover({ note, cover, roomId, userId, editable }: { note: Note; cover: NoteCover; roomId: string; userId: string; editable: boolean }) {
  // 自分のボックスに無い画像（ほかの人がマイメディアから選んだカバーなど）は、ノートを見られるなら引いてくる（画像のブロックと同じ）
  useMediaByIds(cover.mediaId ? [cover.mediaId] : []);
  const thumb = useBlobUrl(cover.mediaId || undefined, "thumb");
  const original = useBlobUrl(cover.mediaId || undefined, "original");
  const url = original ?? thumb;
  const pop = usePopover();
  const [picking, setPicking] = useState(false);
  // 位置を調整している間の高さ（null なら調整していない）
  const [moving, setMoving] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const y = moving ?? cover.y ?? 50;
  const gallery = cover.gradient ? COVER_GALLERY[cover.gradient] : undefined;

  const onPointerDown = (e: React.PointerEvent) => {
    if (moving === null || !box.current || !img.current?.naturalWidth) return;
    e.preventDefault();
    const b = box.current.getBoundingClientRect();
    const { naturalWidth: w, naturalHeight: h } = img.current;
    // 切り抜いて並べたときに、上下にはみ出す高さ（はみ出さなければ動かせない）
    const over = h * Math.max(b.width / w, b.height / h) - b.height;
    if (over <= 1) return;
    const startY = e.clientY;
    const start = moving;
    const onMove = (ev: PointerEvent) => setMoving(Math.min(100, Math.max(0, start - ((ev.clientY - startY) / over) * 100)));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={box}
      data-name="カバー"
      className="group/cover note-cover"
      // 位置を調整している間だけ、指でのドラッグをスクロールにしない
      style={{ background: gallery?.css ?? (cover.mediaId ? undefined : COVER_GALLERY.sky.css), touchAction: moving !== null ? "none" : undefined }}
      onPointerDown={onPointerDown}
    >
      {cover.mediaId && url && (
        // eslint-disable-next-line @next/next/no-img-element -- ブラウザ内の Blob なので next/image は使えない
        <img
          ref={img}
          src={url}
          alt=""
          draggable={false}
          title={moving !== null ? "上下にドラッグして位置を変える" : undefined}
          className={`h-full w-full object-cover select-none ${moving !== null ? "cursor-move" : ""}`}
          style={{ objectPosition: `center ${y}%` }}
        />
      )}
      {editable && (
        <div
          className={`absolute right-[clamp(16px,4vw,40px)] bottom-3 flex overflow-hidden rounded-[8px] bg-card/90 text-xs shadow-sm backdrop-blur transition-opacity ${moving !== null || pop.anchor ? "opacity-100" : "opacity-0 group-hover/cover:opacity-100 [@media(hover:none)]:opacity-100"}`}
        >
          {moving !== null ? (
            <>
              <CoverButton
                onClick={() => {
                  void setNoteCover(note.id, { ...cover, y: Math.round(moving) });
                  setMoving(null);
                }}
              >
                位置を保存
              </CoverButton>
              <CoverButton onClick={() => setMoving(null)}>キャンセル</CoverButton>
            </>
          ) : (
            <>
              <CoverButton onClick={pop.toggle}>カバーを変更</CoverButton>
              {cover.mediaId && <CoverButton onClick={() => setMoving(cover.y ?? 50)}>位置を調整</CoverButton>}
            </>
          )}
        </div>
      )}
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={300} align="end" label="カバー">
          <MenuLabel>ギャラリー</MenuLabel>
          <div className="grid grid-cols-5 gap-1.5 px-2 pb-2">
            {Object.entries(COVER_GALLERY).map(([id, g]) => (
              <button
                key={id}
                type="button"
                aria-label={g.label}
                title={g.label}
                onClick={() => {
                  void setNoteCover(note.id, { gradient: id });
                  pop.close();
                }}
                className={`h-9 rounded-[6px] ring-accent hover:ring-2 ${cover.gradient === id ? "ring-2" : ""}`}
                style={{ background: g.css }}
              />
            ))}
          </div>
          <MenuDivider />
          <MenuItem
            icon={<Icon name="img" size={16} />}
            onClick={() => {
              pop.close();
              setPicking(true);
            }}
          >
            メディアから選ぶ
          </MenuItem>
          <MenuItem
            icon={<Icon name="del" size={16} />}
            danger
            onClick={() => {
              pop.close();
              void setNoteCover(note.id, null);
            }}
          >
            カバーを外す
          </MenuItem>
        </Popover>
      )}
      {picking && (
        <MediaPicker
          roomId={roomId}
          userId={userId}
          single
          pickLabel="カバーにする"
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setPicking(false);
            if (picked[0]) void setNoteCover(note.id, { mediaId: picked[0], y: 50 });
          }}
        />
      )}
    </div>
  );
}

function CoverButton({ children, onClick }: { children: React.ReactNode; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" onClick={onClick} className="h-7 px-2.5 text-muted not-last:border-r not-last:border-line hover:bg-tint hover:text-ink">
      {children}
    </button>
  );
}
