"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { turnstileEnabled, turnstileIsTest, turnstileSiteKey } from "@/lib/turnstile";

// Cloudflare Turnstile の確認の欄。ふつうは何もしなくても数秒で「成功しました」になり、怪しいときだけ確認を求められる

type TurnstileApi = {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Cloudflare のスクリプトを1回だけ読み込む */
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return (loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("turnstile"));
    };
    document.head.appendChild(s);
  }));
}

/** アプリの表示モード（ホワイト・ダーク）に合わせる */
function appTheme(): "light" | "dark" {
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 確認の欄と、届いた token。token は1回しか使えないので、送ったあとは（うまくいかなくても）reset() で出し直す。
 * active を false にすると出さない（ローカル版の設定の画面など、確かめが要らないところ）
 */
export function useTurnstile(active = true) {
  const on = active && turnstileEnabled;
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !box.current) return;
        widget.current = ts.render(box.current, {
          sitekey: turnstileSiteKey,
          language: "ja",
          theme: appTheme(),
          size: "flexible",
          callback: (t: string) => {
            setToken(t);
            setFailed(false);
          },
          // 時間が経って使えなくなったら、自動で出し直される
          "expired-callback": () => setToken(null),
          "error-callback": () => {
            setToken(null);
            setFailed(true);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [on]);

  const reset = useCallback(() => {
    setToken(null);
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);

  const element = on ? (
    <div data-name="ロボットではないことの確認">
      <div ref={box} className="min-h-[65px]" />
      {failed && <p className="mt-1 text-xs text-warn">確認の欄がうまく動きませんでした。通信を確かめて、ページを開き直してください。</p>}
      {turnstileIsTest && <p className="mt-1 text-xs text-muted">開発用の試しのキーで動いています（いつも通ります）。</p>}
    </div>
  ) : null;

  return { on, token: on ? (token ?? undefined) : undefined, ready: !on || !!token, element, reset };
}
