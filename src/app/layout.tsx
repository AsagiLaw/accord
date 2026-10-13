import type { Metadata, Viewport } from "next";
import { Zen_Kaku_Gothic_New } from "next/font/google";
import { Housekeeping } from "@/components/app/Housekeeping";
import { AuthGate } from "@/components/auth/AuthGate";
import { NameInspector } from "@/components/NameInspector";
import { OverlayHost } from "@/components/ui/overlay";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import "./globals.css";

const zen = Zen_Kaku_Gothic_New({
  variable: "--font-zen",
  weight: ["400", "700"],
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "依頼ノート",
  description: "イラストレーターとマネージャーのための依頼・メディア・チャット管理",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme は下のスクリプトが描画前に付けるので、ずれの警告は出さない
    <html lang="ja" className={`${zen.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {/* ログインしていなければ、ログインの画面へ */}
        <AuthGate>{children}</AuthGate>
        {/* ゴミ箱の片付け・納期の通知 */}
        <Housekeeping />
        <OverlayHost />
        <NameInspector />
      </body>
    </html>
  );
}
