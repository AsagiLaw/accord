"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// 画面のどこからでも呼べる、お知らせ（元に戻す付き）・選択ダイアログ・名前入力

type Toast = { id: number; message: string; action?: { label: string; run: () => void } };
type ChoiceOption = { label: string; detail?: string; danger?: boolean };
type Dialog =
  | { id: number; kind: "choose"; title: string; body?: string; options: ChoiceOption[]; resolve: (i: number | null) => void }
  | { id: number; kind: "prompt"; title: string; initial: string; placeholder?: string; resolve: (v: string | null) => void };

let toasts: Toast[] = [];
let dialogs: Dialog[] = [];
let seq = 0;
const listeners = new Set<() => void>();
// useSyncExternalStore には毎回同じ物を返す必要があるので、変わったときだけ作り直す
let state = { toasts, dialogs };
const EMPTY = { toasts: [] as Toast[], dialogs: [] as Dialog[] };
const emit = () => {
  state = { toasts, dialogs };
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function toast(message: string, action?: Toast["action"]) {
  const t = { id: ++seq, message, action };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => dismissToast(t.id), 6000);
}

function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function choose(title: string, options: ChoiceOption[], body?: string): Promise<number | null> {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { id: ++seq, kind: "choose", title, body, options, resolve }];
    emit();
  });
}

export async function confirmAction(title: string, okLabel: string, body?: string, danger = true) {
  return (await choose(title, [{ label: okLabel, danger }], body)) === 0;
}

export function promptText(title: string, initial = "", placeholder?: string): Promise<string | null> {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { id: ++seq, kind: "prompt", title, initial, placeholder, resolve }];
    emit();
  });
}

function close(d: Dialog, value: number | string | null) {
  dialogs = dialogs.filter((x) => x.id !== d.id);
  emit();
  (d.resolve as (v: typeof value) => void)(value);
}

function PromptBody({ d }: { d: Extract<Dialog, { kind: "prompt" }> }) {
  const [value, setValue] = useState(d.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) close(d, value.trim());
      }}
      className="space-y-3"
    >
      <input ref={ref} value={value} onChange={(e) => setValue(e.target.value)} placeholder={d.placeholder} maxLength={60} className="field" />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-sub" onClick={() => close(d, null)}>
          キャンセル
        </button>
        <button className="btn" disabled={!value.trim()}>
          決定
        </button>
      </div>
    </form>
  );
}

export function OverlayHost() {
  const snap = useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
  const top = snap.dialogs.at(-1);

  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(top, null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [top]);

  return (
    <>
      {top && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
          onClick={(e) => e.target === e.currentTarget && close(top, null)}
        >
          <div role="dialog" aria-modal="true" data-overlay aria-label={top.title} data-name={`${top.kind === "prompt" ? "入力" : "確認"}ダイアログ「${top.title}」`} className="w-full max-w-md rounded-t-[20px] border border-line bg-card p-5 sm:rounded-[14px]">
            <h3 className="mb-2 font-bold">{top.title}</h3>
            {top.kind === "choose" ? (
              <>
                {top.body && <p className="mb-3 text-sm text-muted">{top.body}</p>}
                <div className="grid gap-2">
                  {top.options.map((o, i) => (
                    <button
                      key={i}
                      autoFocus={i === 0}
                      onClick={() => close(top, i)}
                      className={`grid min-h-[56px] w-full justify-items-start rounded-[14px] px-4 py-2 text-left ${
                        o.danger ? "bg-warn text-white" : "border border-line hover:bg-tint"
                      }`}
                    >
                      <b>{o.label}</b>
                      {o.detail && <span className="text-[13px] opacity-90">{o.detail}</span>}
                    </button>
                  ))}
                  <button className="btn-sub w-full" onClick={() => close(top, null)}>
                    キャンセル
                  </button>
                </div>
              </>
            ) : (
              <PromptBody key={top.id} d={top} />
            )}
          </div>
        </div>
      )}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2"
      >
        {snap.toasts.map((t) => (
          <div key={t.id} data-name="お知らせ" className="pointer-events-auto flex items-center gap-4 rounded-full bg-ink px-5 py-2.5 text-bg shadow-lg">
            <span>{t.message}</span>
            {t.action && (
              <button
                className="underline"
                onClick={() => {
                  dismissToast(t.id);
                  t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
