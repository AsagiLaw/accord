"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { PopupDialog } from "@/components/ui/Dialog";
import { useIsDesktopApp } from "@/lib/desktop";

type Platform = "windows" | "mac";

const PLATFORMS: Record<Platform, { icon: IconName; name: string; file: string; firstRun: string }> = {
  windows: {
    icon: "windows",
    name: "Windows",
    file: "Accord-Setup.exe",
    firstRun: "初めて開くときに警告が出たら、「詳細情報」→「実行」を選んでください",
  },
  mac: {
    icon: "apple",
    name: "macOS",
    file: "Accord.dmg",
    firstRun: "初めて開くときに止められたら、「システム設定」→「プライバシーとセキュリティ」の「このまま開く」を選んでください",
  },
};

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** デスクトップ版のダウンロードの選択。今の端末の OS を上に出す。Mac 版は配布物を R2 に置いたら出る */
function DownloadAppDialog({ onClose }: { onClose: () => void }) {
  // 読み込み中は undefined
  const [sizes, setSizes] = useState<Partial<Record<Platform, number | null>>>();
  useEffect(() => {
    let alive = true;
    fetch("/api/download")
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
      .then((data) => {
        if (alive) setSizes(data);
      });
    return () => {
      alive = false;
    };
  }, []);

  const order: Platform[] = /Mac/.test(navigator.userAgent) ? ["mac", "windows"] : ["windows", "mac"];
  const offered = order.filter((platform) => platform === "windows" || sizes?.[platform]);

  return (
    <PopupDialog title="アプリをダウンロード" onClose={onClose} width="max-w-md">
      <div data-name="ダウンロードの選択" className="space-y-2">
        {offered.map((platform) => {
          const { icon, name, file, firstRun } = PLATFORMS[platform];
          const size = sizes?.[platform];
          const row = (
            <>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tint text-accent">
                <Icon name={icon} size={22} />
              </span>
              <span className="min-w-0 flex-1 font-bold">{name}</span>
            </>
          );
          if (!size) {
            return (
              <div key={platform} aria-disabled className="flex w-full items-center gap-3 rounded-[12px] border border-line px-4 py-3 opacity-50">
                {row}
                {sizes && <span className="text-xs text-muted">準備中</span>}
              </div>
            );
          }
          return (
            <a
              key={platform}
              href={`/api/download/${platform}`}
              onClick={onClose}
              title={`${file}（${megabytes(size)}）\n${firstRun}`}
              className="flex w-full items-center gap-3 rounded-[12px] border border-line px-4 py-3 transition hover:bg-tint"
            >
              {row}
              <Icon name="download" className="text-muted" />
            </a>
          );
        })}
      </div>
    </PopupDialog>
  );
}

/** ルームバーの「ルームを作る」の下のボタン。デスクトップ版の中と、スマホの幅では出さない */
export function DownloadAppButton() {
  const inDesktopApp = useIsDesktopApp();
  const [open, setOpen] = useState(false);
  if (inDesktopApp) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-name="アプリをダウンロード"
        aria-label="アプリをダウンロード"
        title="アプリをダウンロード"
        className="hidden h-12 w-12 shrink-0 place-items-center rounded-[24px] bg-card text-accent transition-all hover:rounded-[16px] hover:bg-accent hover:text-accent-ink md:grid"
      >
        <Icon name="download" size={24} />
      </button>
      {open && <DownloadAppDialog onClose={() => setOpen(false)} />}
    </>
  );
}
