import type { Metadata, Viewport } from "next";
import { Zen_Kaku_Gothic_New, Zen_Old_Mincho } from "next/font/google";
import { Housekeeping } from "@/components/app/Housekeeping";
import { LocalModeBlocked } from "@/components/app/LocalModeBlocked";
import { AuthGate } from "@/components/auth/AuthGate";
import { NameInspector } from "@/components/NameInspector";
import { OverlayHost } from "@/components/ui/overlay";
import { localModeBlocked } from "@/lib/auth/mode";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import "./globals.css";

const zen = Zen_Kaku_Gothic_New({
  variable: "--font-zen",
  weight: ["400", "700"],
  subsets: ["latin"],
  preload: false,
});

// ノートの書体「明朝」（使うノートを開いたときだけ読み込む）
const mincho = Zen_Old_Mincho({
  variable: "--font-mincho",
  weight: ["400", "700"],
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Accord",
  description: "イラストレーターとマネージャーのための依頼・メディア・チャット管理",
  // iPhone でホーム画面に追加したとき、アプリとして開く（マニフェストは app/manifest.ts）
  appleWebApp: { capable: true, title: "Accord", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // アプリとして開いたときの上の帯の色（globals.css の --bg に合わせる）
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1e1f22" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme は下のスクリプトが描画前に付けるので、ずれの警告は出さない
    <html lang="ja" className={`${zen.variable} ${mincho.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {/* 公開したものが Supabase につながっていなければ、ローカル版を動かさない（ブラウザの中のデータベースも開かない） */}
        {localModeBlocked ? (
          <LocalModeBlocked />
        ) : (
          <>
            {/* ログインしていなければ、ログインの画面へ */}
            <AuthGate>{children}</AuthGate>
            {/* ゴミ箱の片付け・納期の通知 */}
            <Housekeeping />
            <OverlayHost />
            <NameInspector />
          </>
        )}
      </body>
    </html>
  );
}
