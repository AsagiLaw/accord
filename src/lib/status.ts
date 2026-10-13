// ひとことの期限（Discord のカスタムステータスと同じ）。期限を過ぎたひとことは、どこにも出さない

export type StatusExpiry = "never" | "30m" | "1h" | "4h" | "today";

export const STATUS_EXPIRY: { id: StatusExpiry; label: string }[] = [
  { id: "never", label: "消さない" },
  { id: "30m", label: "30分" },
  { id: "1h", label: "1時間" },
  { id: "4h", label: "4時間" },
  { id: "today", label: "今日中" },
];

/** 選んだ期限の時刻。消さないときは undefined。今日中は、今日の終わり（次の日の0時） */
export function expiryAt(id: StatusExpiry, now = Date.now()): number | undefined {
  const min = 60_000;
  if (id === "30m") return now + 30 * min;
  if (id === "1h") return now + 60 * min;
  if (id === "4h") return now + 240 * min;
  if (id === "today") {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }
  return undefined;
}

/** 今出すひとこと。期限を過ぎていれば undefined */
export function liveStatus(p: { statusText?: string; statusExpiresAt?: number }, now = Date.now()) {
  if (!p.statusText) return undefined;
  if (p.statusExpiresAt && p.statusExpiresAt <= now) return undefined;
  return p.statusText;
}

/** 期限の言い方：「14:30まで」。今日でなければ「10/14 0:00まで」 */
export function expiryLabel(at: number, now = Date.now()) {
  const d = new Date(at);
  // 「今日中」で選んだもの（次の日の0時）は、そのまま「今日いっぱい」と言う
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  if (at === midnight.getTime()) return "今日いっぱい";
  const time = d.toLocaleTimeString("ja-JP", { hour: "numeric", minute: "2-digit" });
  const today = new Date(now).toDateString() === d.toDateString();
  return `${today ? "" : `${d.getMonth() + 1}/${d.getDate()} `}${time}まで`;
}
