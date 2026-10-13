import type { Presence } from "@/lib/local/db";
import type { ShownPresence } from "@/lib/local/presence";

/** 自分で選べる状態（並び順） */
export const PRESENCE_CHOICES: Presence[] = ["online", "idle", "dnd", "invisible"];

/** 状態の名前と、印の色。offline は、サイトを開いていない人（選ぶものではない） */
export const PRESENCE: Record<ShownPresence, { label: string; dot: string }> = {
  online: { label: "オンライン", dot: "bg-online" },
  idle: { label: "退席中", dot: "bg-idle" },
  dnd: { label: "取り込み中", dot: "bg-dnd" },
  invisible: { label: "オフライン表示", dot: "bg-muted" },
  offline: { label: "オフライン", dot: "bg-muted" },
};

/**
 * 人の丸いアイコン：画像が無ければ名前の最初の1文字（絵文字も1文字として扱う）。
 * onAccent：選んでいる行など、アクセントの色の上に置くとき（同じ色で見えなくならないよう白地にする）。
 * presence を渡すと、Discord のように右下に状態の印を付ける。ring は印のふちの色（置く場所の背景に合わせる）
 */
export function Avatar({
  name,
  src,
  size = 36,
  onAccent,
  presence,
  ring = "border-card",
}: {
  name: string;
  src?: string;
  size?: number;
  onAccent?: boolean;
  presence?: ShownPresence;
  ring?: string;
}) {
  const dot = Math.max(10, Math.round(size * 0.32));
  return (
    <span aria-hidden className="relative inline-grid shrink-0" style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span
          className={`grid h-full w-full place-items-center rounded-full font-bold text-accent ${onAccent ? "bg-card" : "bg-tint"}`}
          style={{ fontSize: size * 0.42 }}
        >
          {Array.from(name.trim())[0] ?? "?"}
        </span>
      )}
      {presence && (
        <span
          className={`absolute -right-0.5 -bottom-0.5 rounded-full border-[3px] bg-clip-padding ${ring} ${PRESENCE[presence].dot}`}
          style={{ width: dot + 6, height: dot + 6 }}
        />
      )}
    </span>
  );
}
