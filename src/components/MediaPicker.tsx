"use client";

import { useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { toast } from "@/components/ui/overlay";
import { Select } from "@/components/ui/Select";
import { ensureMyMedia, useBoxMembers, useMyBoxes, useRoomBox } from "@/lib/local/boxes";
import type { Library, Media } from "@/lib/local/db";
import { useLibraries, useMedia, uploadFiles } from "@/lib/local/media";
import { IMAGE_ACCEPT } from "@/lib/media/image";
import { arrange, chain, childrenOf, coverOf, isUnsorted, labelOf, libraryView, searchMedia, THUMB_SIZES } from "@/lib/media/logic";
import { MEDIA_DRAG_TYPE } from "@/lib/media/export";
import { filesFromDrop, type ImportFile } from "@/lib/media/folders";
import { useMediaPrefs } from "@/lib/media/prefs";
import { ThumbImage } from "@/components/ThumbImage";
import { CoverCard } from "@/components/media/LibraryCard";
import { SortMenu } from "@/components/media/SortMenu";
import { isBackdropClick } from "@/components/ui/backdrop";

/** 左のサイドバーで選んでいる場所（メディアの画面と同じ並び） */
type Place = "home" | "unsorted" | "fav" | `lib:${string}`;

/**
 * メディアから画像を選ぶダイアログ。チャットやノートに画像を貼るときは必ずここを通る。
 * 見た目と使い方はメディアの画面を小さくしたもの：左にサイドバー（ボックス・ホーム・未整理・お気に入り・ライブラリー）、
 * 上に検索と「並べ替えと表示」（メディアの画面と同じ設定。変えるとメディアの画面にも効く）、真ん中に画像。ライブラリーへの整理はここではできない。
 * はじめはルームに紐づいたボックス（ルームの外や、紐づいていなければマイメディア）を出し、使えるほかのボックスにも切り替えられる。
 * 新しい画像もここからアップロードでき、開いているボックスの「未整理」に入る（見るだけのボックスなら、マイメディアに入る）。
 * メディアの画面の「このライブラリーに画像を追加」もここを使う（box でボックスを決め、initial で今入っている画像を選んだ状態から始める）。
 */
export function MediaPicker({
  roomId,
  userId,
  onPick,
  onClose,
  single,
  pickLabel,
  mineOnly,
  box,
  initial,
  title,
  filter,
  tools,
}: {
  /** 開いているルーム（DM など、ルームの外なら空） */
  roomId: string;
  userId: string;
  onPick: (ids: string[]) => void;
  onClose: () => void;
  /** 1枚だけ選ぶ（アイコンなど）。押すと、前に選んでいたものと入れ替わる */
  single?: boolean;
  /** 決めるボタンの文字（無ければ「N枚を貼る」） */
  pickLabel?: string;
  /** マイメディアだけから選ぶ（自分のアイコンなど）。ほかのボックスには切り替えられない */
  mineOnly?: boolean;
  /** このボックスだけから選ぶ。ほかのボックスには切り替えられない */
  box?: string;
  /** はじめから選んでおく画像。あるときは、選び方が変わったら決められる（全部外しても決められる） */
  initial?: string[];
  /** 上の見出し（無ければ「メディアから選ぶ」） */
  title?: string;
  /** 並べる画像を絞る */
  filter?: (m: Media) => boolean;
  /** 見出しの右に出す、呼び出し元の切り替えなど */
  tools?: React.ReactNode;
}) {
  const boxes = useMyBoxes(userId);
  const roomBox = useRoomBox(roomId);
  const [picked, setPicked] = useState<string | null>(null);
  const roomBoxId = roomBox && boxes?.access.has(roomBox.box.id) ? roomBox.box.id : undefined;
  const boxId = box ?? (mineOnly ? (boxes?.mine?.id ?? "") : (picked ?? roomBoxId ?? boxes?.mine?.id ?? ""));
  const canAdd = ["owner", "edit"].includes(boxes?.access.get(boxId) ?? "");
  const media = useMedia(boxId);
  const libs = useLibraries(boxId);
  const members = useBoxMembers(boxId);
  const prefs = useMediaPrefs();
  const [place, setPlace] = useState<Place>("home");
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>(initial ?? []);
  // 上の欄に並べる画像。はじめから選んであるときは、新しく選んだものだけ（外したものは枚数だけ出す）
  const fresh = initial ? chosen.filter((x) => !initial.includes(x)) : chosen;
  const dropped = initial ? initial.filter((x) => !chosen.includes(x)).length : 0;
  // 選んだ順の番号は、何も選んでいないところから選ぶときだけ
  const numbered = !single && !initial;
  const changed = initial ? chosen.length !== initial.length || chosen.some((x) => !initial.includes(x)) : chosen.length > 0;
  // 選んだ画像の名前（ほかのボックスへ移っても、選択中の欄に名前を出せるように）
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // スマホでは、サイドバーを画像の上に重ねて出す（押すと出る）
  const [navOpen, setNavOpen] = useState(false);

  const allLibs = useMemo(() => libs ?? [], [libs]);
  const libId = place.startsWith("lib:") ? place.slice(4) : null;
  const lib = libId ? allLibs.find((l) => l.id === libId) : undefined;
  const alive = useMemo(() => (media ?? []).filter((m) => !m.trashed), [media]);
  const unsortedCount = alive.filter(isUnsorted).length;

  // 今の場所に並べる画像（メディアの画面と同じ並べ方）。検索中は、ホームならボックス全体、ライブラリーなら子ライブラリーの画像も探す
  const list = useMemo(() => {
    const q = query.trim();
    let pool: Media[];
    if (place === "unsorted") pool = alive.filter(isUnsorted);
    else if (place === "fav") pool = alive.filter((m) => m.fav);
    else if (lib) pool = q ? alive.filter((m) => m.libIds.includes(lib.id)) : libraryView(alive, allLibs, lib.id, prefs.libMode);
    else pool = alive;
    if (filter) pool = pool.filter(filter);
    const sorted = arrange(pool, prefs);
    if (!q) return sorted;
    return searchMedia(sorted, q, (id) => members?.find((x) => x.userId === id)?.displayName ?? "");
  }, [place, alive, lib, allLibs, prefs, query, members, filter]);

  // ホームとライブラリーでは、すぐ下のライブラリーをカードで先に並べる（検索中は出さない）
  const cards = query.trim() || (place !== "home" && !lib) ? [] : childrenOf(allLibs, lib?.id ?? null);

  const go = (p: Place) => {
    setPlace(p);
    setQuery("");
    setNavOpen(false);
  };

  const upload = async (files: (File | ImportFile)[]) => {
    if (!files.length) return;
    setBusy(true);
    const target = canAdd ? boxId : await ensureMyMedia(userId);
    const { ids, failed, libs } = await uploadFiles(target, userId, files);
    setBusy(false);
    if (target !== boxId) {
      setPicked(target);
      toast("このボックスは見るだけなので、マイメディアに追加しました");
    }
    if (failed) toast(`${failed}枚は読み込めない形式のため追加できませんでした`);
    // アップロードした画像は「未整理」（フォルダごと入れたら、フォルダ名のライブラリー）に入るので、そこを開いて、選んだ状態にする
    setChosen((c) => (single ? ids.slice(0, 1) : [...c, ...ids]));
    go(libs.length ? `lib:${libs[0].id}` : "unsorted");
  };

  // Shift を押しながら押したときの起点（最後にふつうに押した画像）。メディアの画面と同じ
  const anchor = useRef<string | null>(null);

  const remember = (ids: string[]) => {
    const add = Object.fromEntries(alive.filter((m) => ids.includes(m.id)).map((m) => [m.id, m.name]));
    setNames((n) => ({ ...n, ...add }));
  };

  const toggle = (id: string) => {
    remember([id]);
    const i = chosen.indexOf(id);
    setChosen(i >= 0 ? chosen.filter((x) => x !== id) : single ? [id] : [...chosen, id]);
  };

  /** 画像を押したとき。Shift を押していれば、起点からここまでを並んでいる順にまとめて選ぶ（選んでいるものに足す） */
  const onTile = (e: React.MouseEvent, id: string) => {
    const ids = list.map((m) => m.id);
    if (e.shiftKey && !single && anchor.current && ids.includes(anchor.current)) {
      const a = ids.indexOf(anchor.current);
      const b = ids.indexOf(id);
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      if (a > b) range.reverse();
      remember(range);
      setChosen((c) => [...c, ...range.filter((x) => !c.includes(x))]);
      return;
    }
    anchor.current = id;
    toggle(id);
  };

  const size = THUMB_SIZES[prefs.level - 1] ?? THUMB_SIZES[2];
  const heading = title ?? (mineOnly ? "マイメディアから選ぶ" : "メディアから選ぶ");
  const placeName = place === "home" ? "ホーム" : place === "unsorted" ? "未整理" : place === "fav" ? "お気に入り" : (lib?.name ?? "");

  return (
    <div className="sheet-backdrop fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={(e) => isBackdropClick(e) && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        data-name="メディアから選ぶ"
        className="flex h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[20px] border border-line bg-card sm:h-[min(88dvh,760px)] sm:rounded-[14px]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          // メディアの画像をドラッグしてきたときは、ファイルの追加として扱わない
          if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
          // フォルダごと入れたときは、中の画像をすべて入れる
          void filesFromDrop(e.dataTransfer).then(upload);
        }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
          <h3 className="min-w-0 truncate font-bold max-sm:flex-1">{heading}</h3>
          {/* 見出しの右に、呼び出し元の切り替え（スマホでは下の段に全幅で） */}
          {tools && <div className="flex gap-1.5 overflow-x-auto whitespace-nowrap max-sm:order-last max-sm:w-full">{tools}</div>}
          <div className="ml-auto flex shrink-0 gap-2 whitespace-nowrap">
            <button className="btn-sub" onClick={onClose}>
              キャンセル
            </button>
            <button className="btn" disabled={!changed} onClick={() => onPick(chosen)}>
              {pickLabel ?? (chosen.length ? `${chosen.length}枚を貼る` : "貼る")}
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1">
          {/* スマホでサイドバーを出している間は、画像の側を暗くする（押すと閉じる） */}
          {navOpen && <div className="absolute inset-0 z-10 animate-[fade_.2s] bg-black/30 md:hidden" onClick={() => setNavOpen(false)} />}
          <aside
            data-name="メディアから選ぶのサイドバー"
            className={`flex w-60 shrink-0 flex-col gap-2 border-r border-line bg-sidebar p-2 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:w-[min(260px,80%)] max-md:shadow-xl ${navOpen ? "max-md:animate-[fade_.2s]" : "max-md:hidden"}`}
          >
            {boxes && !mineOnly && !box && (
              <Select
                value={boxId}
                onChange={(v) => {
                  setPicked(v);
                  go("home");
                }}
                label="ボックス"
                className="w-full shrink-0 font-bold"
                options={[...(boxes.mine ? [boxes.mine] : []), ...boxes.own, ...boxes.shared].map((b) => ({ value: b.id, label: `${b.name}${b.id === roomBox?.box.id ? "（このルーム）" : ""}` }))}
              />
            )}
            {canAdd ? (
              <label className={`btn-sub cursor-pointer font-bold ${busy ? "opacity-50" : ""}`}>
                <Icon name="upload" />
                {busy ? "読み込み中…" : "メディアを追加"}
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  multiple
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = "";
                    upload(files);
                  }}
                />
              </label>
            ) : (
              <p className="flex items-center gap-1.5 rounded-[10px] bg-tint px-3 py-1.5 text-xs text-muted">
                <Icon name="eye" size={14} className="shrink-0" />
                見るだけのボックスです
              </p>
            )}
            <PickerNav libs={allLibs} place={place} unsorted={unsortedCount} onGo={go} />
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <button
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink md:hidden"
                aria-label="場所を選ぶ"
                aria-expanded={navOpen}
                onClick={() => setNavOpen(!navOpen)}
              >
                <Icon name="menu" />
              </button>
              {/* 今いる場所。ライブラリーなら、上のライブラリーへ戻れる */}
              <nav aria-label="今いる場所" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
                {lib ? (
                  <>
                    <button className="shrink-0 rounded-[6px] px-1 text-muted hover:bg-tint hover:text-ink" onClick={() => go("home")}>
                      ホーム
                    </button>
                    {chain(allLibs, lib.id).map((l) => (
                      <span key={l.id} className="flex min-w-0 items-center gap-1">
                        <Icon name="rt" size={14} className="shrink-0 text-muted" />
                        {l.id === lib.id ? (
                          <b className="truncate">{l.name}</b>
                        ) : (
                          <button className="truncate rounded-[6px] px-1 text-muted hover:bg-tint hover:text-ink" onClick={() => go(`lib:${l.id}`)}>
                            {l.name}
                          </button>
                        )}
                      </span>
                    ))}
                  </>
                ) : (
                  <b className="truncate">{placeName}</b>
                )}
              </nav>
              <label className="flex h-9 w-[min(220px,40%)] items-center gap-1.5 rounded-full border border-line bg-bg px-3 text-sm focus-within:border-accent">
                <Icon name="search" size={16} className="shrink-0 text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // 検索だけを消す（ダイアログは閉じない）
                    if (e.key === "Escape" && query) {
                      e.stopPropagation();
                      setQuery("");
                    }
                  }}
                  placeholder={`${placeName}を検索`}
                  aria-label={`${placeName}の中を検索`}
                  className="min-w-0 flex-1 bg-transparent outline-none"
                />
              </label>
              <SortMenu showLibMode={!!lib} iconOnly />
            </div>

            {/* 選んでいる画像（ライブラリーやボックスを移っても、何を選んでいるかがわかるように）。左から選んだ順 */}
            {(fresh.length > 0 || dropped > 0) && (
              <div data-name="選んでいる画像" className="flex items-center gap-2 border-b border-line bg-bg px-3 py-2">
                <ol className="flex min-w-0 flex-1 gap-3 overflow-x-auto px-1.5 pt-2 pb-1">
                  {fresh.map((id, i) => {
                    const name = alive.find((m) => m.id === id)?.name ?? names[id] ?? "";
                    return (
                      <li key={id} className="anim-pop relative shrink-0" title={name}>
                        <span className="block h-11 w-11 overflow-hidden rounded-[8px] border border-accent bg-card">
                          <ThumbImage id={id} alt={name} />
                        </span>
                        {numbered && (
                          <span className="pointer-events-none absolute -top-1 -left-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-0.5 text-[11px] leading-none font-bold text-accent-ink">{i + 1}</span>
                        )}
                        <button
                          aria-label={name ? `「${name}」を選ぶのをやめる` : "選ぶのをやめる"}
                          title="選ぶのをやめる"
                          onClick={() => toggle(id)}
                          className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-card text-muted shadow-sm hover:text-ink"
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
                {/* 右の端に「すべて外す」と、その下に枚数（場所を取らないように縦に重ねる） */}
                <div className="flex shrink-0 flex-col items-center gap-0.5">
                  {fresh.length > 1 && (
                    <button className="rounded-full px-2 py-0.5 text-xs text-muted hover:bg-tint hover:text-ink" onClick={() => setChosen(chosen.filter((x) => !fresh.includes(x)))}>
                      すべて外す
                    </button>
                  )}
                  <span className="text-xs whitespace-nowrap text-muted" aria-live="polite">
                    {initial ? (
                      <>
                        {fresh.length > 0 && <>＋<b className="text-ink">{fresh.length}</b>枚</>}
                        {fresh.length > 0 && dropped > 0 && " "}
                        {dropped > 0 && <>−<b className="text-ink">{dropped}</b>枚</>}
                      </>
                    ) : (
                      <>
                        <b className="text-ink">{chosen.length}</b>枚
                      </>
                    )}
                  </span>
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
              {cards.length > 0 && (
                <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.min(size * 1.5, 200)}px, 1fr))` }}>
                  {cards.map((l) => (
                    <CoverCard key={l.id} name={l.name} covers={coverOf(alive, l)} count={alive.filter((m) => m.libIds.includes(l.id)).length} onClick={() => go(`lib:${l.id}`)} />
                  ))}
                </div>
              )}
              {list.length ? (
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${size}px, 40%), 1fr))` }}>
                  {list.map((m) => {
                    const i = chosen.indexOf(m.id);
                    return (
                      <button
                        key={m.id}
                        aria-pressed={i >= 0}
                        aria-label={m.name}
                        title={single ? "ダブルクリックで、すぐに決める" : "Shift を押しながら押すと、まとめて選べます"}
                        // マウスで押したときは、画像にフォーカスを移さない。Shift を押したときにフォーカスの四角い枠が出たり、
                        // Shift＋クリックで文字が選ばれたりしないように（キーボードの Tab で移ったときの枠は、そのまま出る）
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => onTile(e, m.id)}
                        // 1枚だけ選ぶときは、ダブルクリックでそのまま決める（メディアの画面でダブルクリックで開くのと同じ手ざわり）
                        onDoubleClick={single ? () => onPick([m.id]) : undefined}
                        className="group min-w-0 text-left select-none"
                      >
                        <span
                          className={`relative block aspect-square overflow-hidden rounded-[12px] border bg-card transition duration-300 group-active:scale-95 motion-safe:group-hover:-translate-y-[3px] ${i >= 0 ? "border-accent ring-2 ring-accent" : "border-line"}`}
                        >
                          <ThumbImage id={m.id} alt="" />
                          {i >= 0 && (
                            <span className="absolute top-1.5 left-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-accent-ink">
                              {numbered ? i + 1 : <Icon name="ok" size={14} />}
                            </span>
                          )}
                          {m.fav && <Icon name="star" size={14} className="absolute right-1.5 bottom-1.5 text-yellow-300 drop-shadow" />}
                        </span>
                        <span className={`mt-1 block truncate px-0.5 text-xs ${i >= 0 ? "font-bold text-ink" : "text-muted"}`}>{labelOf(m, prefs.showExt)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                !cards.length && (
                  <p className="py-10 text-center text-sm text-muted">
                    {query.trim()
                      ? `「${query.trim()}」に合う画像はありません`
                      : canAdd
                        ? "画像がありません。「メディアを追加」か、ここに画像をドラッグしてください。"
                        : "画像がありません"}
                  </p>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 選ぶ画面のサイドバーの一覧（メディアの画面のサイドバーと同じ見た目。並べ替えやメニューは無い） */
function PickerNav({ libs, place, unsorted, onGo }: { libs: Library[]; place: Place; unsorted: number; onGo: (p: Place) => void }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const current = place.startsWith("lib:") ? place.slice(4) : null;
  // 今開いているライブラリーの上の階層は、はじめから開いておく
  const openByDefault = new Set(
    chain(libs, current)
      .map((l) => l.id)
      .slice(0, -1),
  );
  const isOpen = (id: string) => toggled[id] ?? openByDefault.has(id);

  const row = (p: Place, icon: IconName, label: string, depth: number, toggle?: React.ReactNode, extra?: React.ReactNode) => {
    const active = place === p;
    return (
      <div
        key={p}
        className={`flex min-h-[38px] items-center rounded-[10px] transition ${active ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"}`}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <span className="grid w-7 shrink-0 place-items-center">{toggle}</span>
        <button onClick={() => onGo(p)} aria-current={active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
          <Icon name={icon} size={16} className="shrink-0" />
          <span className="truncate">{label}</span>
        </button>
        {extra}
      </div>
    );
  };

  const libNode = (l: Library, depth: number): React.ReactNode => {
    const kids = childrenOf(libs, l.id);
    const open = isOpen(l.id);
    return (
      <div key={l.id}>
        {row(
          `lib:${l.id}`,
          "folder",
          l.name,
          depth,
          kids.length > 0 && (
            <button
              aria-label={open ? "たたむ" : "開く"}
              aria-expanded={open}
              onClick={() => setToggled({ ...toggled, [l.id]: !open })}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-tint"
            >
              <Icon name={open ? "dn" : "rt"} size={16} />
            </button>
          ),
        )}
        {open && kids.map((k) => libNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div data-name="メディアの一覧" className="space-y-0.5">
        {row("home", "home", "ホーム", 0)}
        {row("unsorted", "img", "未整理", 1, undefined, unsorted > 0 && <span className="mr-2 rounded-full bg-warn px-2 text-xs text-white">{unsorted}</span>)}
        {row("fav", "star", "お気に入り", 1)}
      </div>
      <h6 className="mx-1 mt-5 mb-1 px-2 text-xs text-muted">ライブラリー</h6>
      <div data-name="ライブラリー一覧" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {childrenOf(libs, null).map((l) => libNode(l, 0))}
        {!libs.length && <p className="px-3 text-xs text-muted">ライブラリーはありません</p>}
      </div>
    </div>
  );
}
