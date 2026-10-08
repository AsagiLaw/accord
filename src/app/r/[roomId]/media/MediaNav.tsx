"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { Library } from "@/lib/local/db";
import { useLibraries, useMedia } from "@/lib/local/media";
import { chain, childrenOf, descendants, isUnsorted } from "@/lib/media/logic";
import { dropLibraryFlow, libraryMenuFlow, newLibraryFlow, uploadFlow } from "./flows";

type Zone = { zone: "before" | "after" | "inside"; targetId: string } | { zone: "root" };
type DragState = { id: string; x: number; y: number; on: boolean; armed: boolean; timer?: ReturnType<typeof setTimeout> };

/** メディアを開いている間のサイドバーの中身 */
export function MediaNav({ roomId, userId }: { roomId: string; userId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const media = useMedia(roomId) ?? [];
  const libs = useLibraries(roomId) ?? [];
  const base = `/r/${roomId}/media`;
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  // ---- ライブラリーのドラッグ（試作と同じ：前・後ろに並べる／中に入れる／見出しで一番上へ） ----
  const drag = useRef<DragState | null>(null);
  const justDragged = useRef(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string; id: string } | null>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  const zoneRef = useRef<Zone | null>(null);
  const latest = useRef({ libs, media });
  useEffect(() => {
    latest.current = { libs, media };
  });

  const endDrag = (drop: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (d?.timer) clearTimeout(d.timer);
    const z = zoneRef.current;
    zoneRef.current = null;
    setZone(null);
    setGhost(null);
    document.body.style.removeProperty("user-select");
    if (d?.on) {
      // ドラッグの直後のクリックで、ライブラリーが開いてしまわないようにする
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 60);
      if (drop && z) void dropLibraryFlow(roomId, latest.current.libs, latest.current.media, d.id, z);
    }
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.on) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
        // タッチは長押ししてからでないと動かさない（スクロールと区別する）
        if (!d.armed) return endDrag(false);
        d.on = true;
        document.body.style.userSelect = "none";
      }
      const lib = latest.current.libs.find((l) => l.id === d.id);
      setGhost({ x: e.clientX, y: e.clientY, name: lib?.name ?? "", id: d.id });
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el?.closest<HTMLElement>("[data-lib]");
      let z: Zone | null = null;
      if (el?.closest("[data-lib-root]")) z = { zone: "root" };
      else if (row && !descendants(latest.current.libs, d.id).includes(row.dataset.lib!)) {
        const r = row.getBoundingClientRect();
        const f = (e.clientY - r.top) / r.height;
        z = { zone: f < 0.3 ? "before" : f > 0.7 ? "after" : "inside", targetId: row.dataset.lib! };
      }
      zoneRef.current = z;
      setZone(z);
    };
    const onUp = (e: PointerEvent) => drag.current && endDrag(e.type === "pointerup");
    const onTouchMove = (e: TouchEvent) => drag.current?.on && e.preventDefault();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("touchmove", onTouchMove);
    };
    // endDrag は ref だけを使うので、最初の1回だけ登録すればよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDrag = (e: React.PointerEvent, id: string) => {
    if (e.button > 0 || (e.target as HTMLElement).closest("button")) return;
    const d: DragState = { id, x: e.clientX, y: e.clientY, on: false, armed: e.pointerType !== "touch" };
    if (!d.armed) {
      d.timer = setTimeout(() => {
        d.armed = true;
        navigator.vibrate?.(8);
      }, 320);
    }
    drag.current = d;
  };

  const currentLib = pathname.startsWith(`${base}/lib/`) ? pathname.slice(`${base}/lib/`.length) : null;
  const openByDefault = new Set(chain(libs, currentLib).map((l) => l.id).slice(0, -1));
  const isOpen = (id: string) => toggled[id] ?? openByDefault.has(id);
  const unsorted = media.filter(isUnsorted).length;

  const row = (href: string, label: React.ReactNode, depth = 0, extra?: React.ReactNode, toggle?: React.ReactNode, libId?: string) => {
    const active = pathname === href;
    const z = libId && zone && zone.zone !== "root" && zone.targetId === libId ? zone.zone : null;
    const dragging = libId && ghost?.id === libId;
    return (
      <div
        data-lib={libId}
        onPointerDown={libId ? (e) => startDrag(e, libId) : undefined}
        className={`group flex min-h-[38px] items-center rounded-[10px] transition ${active ? "bg-accent font-bold text-accent-ink" : "hover:bg-tint"} ${
          z === "before" ? "shadow-[inset_0_3px_0_var(--accent)]" : z === "after" ? "shadow-[inset_0_-3px_0_var(--accent)]" : z === "inside" ? "bg-tint outline-2 -outline-offset-2 outline-accent" : ""
        } ${dragging ? "opacity-40" : ""}`}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <span className="grid w-7 shrink-0 place-items-center">{toggle}</span>
        <Link href={href} draggable={false} className="min-w-0 flex-1 truncate py-1.5">
          {label}
        </Link>
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
          `${base}/lib/${l.id}`,
          l.name,
          depth,
          <button
            aria-label={`「${l.name}」のメニュー`}
            onClick={() => libraryMenuFlow(roomId, l, libs, media, () => currentLib && chain(libs, currentLib).some((x) => x.id === l.id) && router.push(base))}
            className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full opacity-60 hover:bg-tint hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
          >
            <Icon name="dots" size={16} />
          </button>,
          kids.length > 0 && (
            <button aria-label={open ? "たたむ" : "開く"} aria-expanded={open} onClick={() => setToggled({ ...toggled, [l.id]: !open })} className="grid h-7 w-7 place-items-center rounded-full hover:bg-tint">
              <Icon name={open ? "dn" : "rt"} size={16} />
            </button>
          ),
          l.id,
        )}
        {open && kids.map((k) => libNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onClickCapture={(e) => {
        if (justDragged.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <Link href={`/r/${roomId}`} className="flex min-h-[38px] items-center gap-2 rounded-[10px] px-3 hover:bg-tint">
        <Icon name="back" />
        戻る
      </Link>
      <label className="btn my-2 cursor-pointer">
        <Icon name="upload" />
        メディアを追加
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            uploadFlow(roomId, userId, files, () => router.push(`${base}/unsorted`));
          }}
        />
      </label>

      <div data-name="メディアの一覧" className="space-y-0.5">
        {row(base, "ホーム", 0, undefined, <Icon name="home" size={16} />)}
        {unsorted > 0 &&
          row(`${base}/unsorted`, "整理されていない画像", 0, <span className="mr-2 rounded-full bg-warn px-2 text-xs text-white">{unsorted}</span>)}
        {row(`${base}/all`, "すべて", 0, undefined, <Icon name="img" size={16} />)}
        {row(`${base}/favorites`, "お気に入り", 0, undefined, <Icon name="star" size={16} />)}
        {row(`${base}/trash`, "ゴミ箱", 0, undefined, <Icon name="del" size={16} />)}
      </div>

      <h6
        data-lib-root
        title="ここにライブラリーをドラッグすると、一番上の階層に出せます"
        className={`mx-1 mt-5 mb-1 flex items-center justify-between rounded-[8px] px-2 text-xs text-muted ${zone?.zone === "root" ? "text-accent outline-2 outline-accent outline-dashed" : ""}`}
      >
        ライブラリー
        <button aria-label="ライブラリーを追加" onClick={() => newLibraryFlow(roomId, null)} className="grid h-7 w-7 place-items-center rounded-full hover:bg-tint">
          <Icon name="add" />
        </button>
      </h6>
      <div data-name="ライブラリー一覧" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {childrenOf(libs, null).map((l) => libNode(l, 0))}
        {!libs.length && <p className="px-3 text-xs text-muted">右の＋で作れます</p>}
        {libs.length > 0 && <p className="px-3 pt-2 text-[11px] text-muted">ドラッグで並べ替え。行の真ん中に落とすと中に入れる・合体、見出しに落とすと一番上へ</p>}
      </div>

      {ghost && (
        <div
          className="pointer-events-none fixed top-0 left-0 z-[70] flex items-center gap-1.5 rounded-full border border-accent bg-card px-3.5 py-1.5 font-bold text-ink shadow-xl"
          style={{ transform: `translate(${ghost.x + 12}px, ${ghost.y + 12}px)` }}
        >
          <Icon name="folder" size={16} />
          {ghost.name}
        </div>
      )}
    </div>
  );
}
