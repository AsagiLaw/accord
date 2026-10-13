import { Icon } from "@/components/Icon";
import type { Profile, ProfileLink, WorkStatus } from "@/lib/local/db";

/** 受付状況の名前と、印の色 */
export const WORK_STATUS: Record<WorkStatus, { label: string; dot: string }> = {
  open: { label: "依頼受付中", dot: "bg-online" },
  consult: { label: "相談のみ受付", dot: "bg-idle" },
  closed: { label: "受付停止中", dot: "bg-muted" },
};

export const BIO_MAX = 400;
export const LINKS_MAX = 5;

/** 入力された URL を、開いてよい形（http / https）に直す。直せなければ null */
export function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** リンクに出す名前：名前が無ければ、サイトの名前（ドメイン） */
export function linkLabel(l: ProfileLink) {
  if (l.label?.trim()) return l.label.trim();
  try {
    return new URL(l.url).hostname.replace(/^www\./, "");
  } catch {
    return l.url;
  }
}

/** 受付状況の小さな印 */
export function WorkStatusChip({ status }: { status: WorkStatus }) {
  return (
    <span data-name="受付状況" className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-bold text-ink">
      <span className={`h-2 w-2 rounded-full ${WORK_STATUS[status].dot}`} />
      {WORK_STATUS[status].label}
    </span>
  );
}

/** プロフィールのカードの下の部分：自己紹介とリンク（Discord の「自己紹介」の欄と同じ） */
export function ProfileExtras({ person }: { person: Profile }) {
  const links = (person.links ?? []).filter((l) => normalizeUrl(l.url));
  if (!person.bio && !links.length) return null;
  return (
    <div data-name="自己紹介とリンク" className="mt-2 space-y-2 rounded-[10px] bg-bg px-2.5 py-2">
      {person.bio && (
        <div>
          <p className="mb-0.5 text-xs font-bold text-muted">自己紹介</p>
          {/* 長いときはカードが伸びすぎないよう、ここだけスクロール */}
          <p className="max-h-36 overflow-y-auto text-sm break-words whitespace-pre-wrap">{person.bio}</p>
        </div>
      )}
      {links.length > 0 && (
        <div>
          <p className="mb-0.5 text-xs font-bold text-muted">リンク</p>
          <ul className="space-y-0.5">
            {links.map((l, i) => (
              <li key={i}>
                <a
                  href={normalizeUrl(l.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={l.url}
                  className="flex min-h-[28px] items-center gap-1.5 rounded-[6px] px-1 text-sm text-accent hover:bg-tint hover:underline"
                >
                  <Icon name="link" size={14} className="shrink-0" />
                  <span className="min-w-0 truncate">{linkLabel(l)}</span>
                  <Icon name="open" size={12} className="shrink-0 opacity-60" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
