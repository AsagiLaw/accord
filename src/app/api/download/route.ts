import { NextResponse } from "next/server";
import { DESKTOP_FILES, desktopFileUrl, r2, type DesktopPlatform } from "@/lib/r2/server";

// デスクトップ版の配布物が R2 にあるかと、その大きさ（無いものは null）。ダウンロードの画面が使う

export async function GET() {
  const platforms = Object.keys(DESKTOP_FILES) as DesktopPlatform[];
  const sizes = await Promise.all(
    platforms.map(async (platform) => {
      const res = await r2?.fetch(desktopFileUrl(platform), { method: "HEAD" }).catch(() => null);
      return res?.ok ? Number(res.headers.get("content-length")) : null;
    }),
  );
  return NextResponse.json(Object.fromEntries(platforms.map((platform, i) => [platform, sizes[i]])));
}
