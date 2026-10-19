/**
 * 利用規約・プライバシーポリシー・お問い合わせのページに出す、運営者の情報。
 * お問い合わせ先は、公開先の環境変数 NEXT_PUBLIC_CONTACT_EMAIL に入れる（空のままだと「準備中」と出す）
 */
export const SITE = {
  name: "Accord",
  /** 運営者の名前 */
  operator: "浅葱 楼",
  /** お問い合わせを受けるメールアドレス */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
  /** 利用規約・プライバシーポリシーを決めた日と、最後に変えた日 */
  legalEstablished: "2026年10月19日",
  legalUpdated: "2026年10月19日",
};

/** 利用規約・プライバシーポリシー・お問い合わせのページ */
export const LEGAL_LINKS = [
  { href: "/terms", label: "利用規約" },
  { href: "/privacy", label: "プライバシーポリシー" },
  { href: "/contact", label: "お問い合わせ" },
] as const;
