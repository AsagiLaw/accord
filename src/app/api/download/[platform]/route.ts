import { NextResponse, type NextRequest } from "next/server";
import { DESKTOP_FILES, desktopFileUrl, r2, type DesktopPlatform } from "@/lib/r2/server";

// デスクトップ版の配布物を渡す。ファイルは Vercel を通さず、期限付きの URL で R2 から直接ダウンロードしてもらう。
// 中身はサイトを開くだけの入れ物で秘密は無いので、ログインは求めない

export async function GET(_request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!Object.hasOwn(DESKTOP_FILES, platform)) return NextResponse.json({ error: "ありません" }, { status: 404 });
  if (!r2) return NextResponse.json({ error: "R2 の設定がありません" }, { status: 503 });
  const key = platform as DesktopPlatform;
  const url = desktopFileUrl(key);
  url.searchParams.set("X-Amz-Expires", "3600");
  url.searchParams.set("response-content-disposition", `attachment; filename="${DESKTOP_FILES[key]}"`);
  const signed = await r2.sign(new Request(url), { aws: { signQuery: true } });
  return NextResponse.redirect(signed.url, { status: 302, headers: { "Cache-Control": "no-store" } });
}
