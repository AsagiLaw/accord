"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Database, PageTemplate } from "@/lib/local/db";
import { createPage, newPageDefaults } from "@/lib/local/requests";
import type { MemberWithProfile } from "@/lib/local/rooms";
import { P } from "@/lib/requests/defaults";
import { PropInput } from "./PropInput";

/** 依頼（ページ）を追加するフォーム。作ったらその依頼のページを開く */
export function NewPageDialog({
  database,
  members,
  userId,
  onClose,
  initial,
  template,
}: {
  database: Database;
  members: MemberWithProfile[];
  userId: string;
  onClose: () => void;
  initial?: Record<string, unknown>;
  /** テンプレートから作るとき。項目の値と本文がテンプレートのものになる */
  template?: PageTemplate;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...newPageDefaults(database), ...template?.values, ...initial }));
  const [busy, setBusy] = useState(false);
  const titleProp = database.props.find((p) => p.type === "title");
  const label = database.kind === "request" ? "依頼" : "ページ";

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={`${label}を追加`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() || busy) return;
          setBusy(true);
          const page = await createPage(database, userId, title.trim(), values, template);
          onClose();
          router.push(`/r/${database.roomId}/db/${database.id}/p/${page.id}`);
        }}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[20px] border border-line bg-card sm:rounded-[14px]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h3 className="min-w-0 font-bold">
            {label}を追加
            {template && <span className="ml-2 text-sm font-normal text-muted">テンプレート：{template.name}</span>}
          </h3>
          <div className="flex gap-2">
            <button type="button" className="btn-sub" onClick={onClose}>
              キャンセル
            </button>
            <button className="btn" disabled={!title.trim() || busy}>
              追加
            </button>
          </div>
        </div>
        <div className="grid gap-3 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="text-sm text-muted">{titleProp?.name ?? "タイトル"}（必須）</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus className="field" placeholder={database.kind === "request" ? "例：〇〇" : ""} />
          </label>
          {database.props
            .filter((p) => p.type !== "title" && p.type !== "chat" && p.type !== "imageChat" && !(database.kind === "request" && p.id === P.status))
            .map((p) => (
              <label key={p.id} className="block" htmlFor={`np-${p.id}`}>
                <span className="text-sm text-muted">{p.name}</span>
                <PropInput
                  id={`np-${p.id}`}
                  database={database}
                  prop={p}
                  value={values[p.id]}
                  onChange={(v) => setValues((cur) => ({ ...cur, [p.id]: v }))}
                  members={members}
                  userId={userId}
                  page={{ values }}
                />
              </label>
            ))}
        </div>
      </form>
    </div>
  );
}
