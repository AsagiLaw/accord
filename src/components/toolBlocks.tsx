"use client";

import { useState } from "react";
import { NewPageDialog } from "@/components/db/NewPageDialog";
import { SettingsButton, useNoteContext } from "@/components/embeds";
import { Icon } from "@/components/Icon";
import { ChoiceScreen, MenuTitle, NavRow, TextField, ToggleRow } from "@/components/ui/SettingsMenu";
import type { Database } from "@/lib/local/db";
import { addTodo, deleteTodo, toggleTodo, useDatabases, useTodos } from "@/lib/local/requests";

// ホームなどで使う道具のブロック（ToDo・追加ボタン）。ノートにもウィンドウにも置ける

// ---- ToDo：ルームのやることリスト ----

/** ルームの ToDo（追加・チェック・削除）。ウィンドウでは残りの高さいっぱいに広げ、入りきらないときは中をスクロール */
export function TodoBlockView({ fill }: { fill?: boolean }) {
  const { roomId, locked } = useNoteContext();
  const todos = useTodos(roomId) ?? [];
  const [text, setText] = useState("");
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <section
      className={`w-full rounded-[14px] border border-line bg-card p-3 ${fill ? "flex h-full flex-col" : ""}`}
      data-fill={fill ? "" : undefined}
      contentEditable={false}
      data-name="ToDo"
    >
      {/* data-block-head / data-block-title：タブの中では見出し（タブの名前と同じ）を出さない */}
      <div className="mb-2 flex items-center gap-2 text-sm" data-block-head="" data-locked={locked ? "" : undefined}>
        <span className="flex items-center gap-2" data-block-title="">
          <Icon name="checkbox" size={16} className="text-muted" />
          <b>ToDo</b>
        </span>
        <span className="text-xs text-muted">{open.length ? `のこり${open.length}つ` : ""}</span>
      </div>
      <form
        className="mb-2 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          await addTodo(roomId, text.trim());
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="やることを追加" aria-label="やることを追加" className="field" />
        <button className="btn w-10 shrink-0 px-0" aria-label="追加" disabled={!text.trim()}>
          <Icon name="add" />
        </button>
      </form>
      <ul className={`space-y-0.5 ${fill ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
        {[...open, ...done].map((t) => (
          <li key={t.id} className="group flex items-center gap-2 rounded-[8px] px-1 py-1 hover:bg-tint">
            <input type="checkbox" checked={t.done} onChange={(e) => toggleTodo(t.id, e.target.checked)} aria-label={t.text} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
            <span className={`min-w-0 flex-1 break-words ${t.done ? "text-muted line-through" : ""}`}>{t.text}</span>
            <button
              aria-label="削除"
              onClick={() => deleteTodo(t.id)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full opacity-0 group-hover:opacity-100 hover:bg-tint focus:opacity-100 max-md:opacity-50"
            >
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
        {!todos.length && <li className="px-1 py-1 text-sm text-muted">やることはありません</li>}
      </ul>
    </section>
  );
}

// ---- 追加ボタン：データベースにページを足すボタン ----

/** 追加ボタンの props（ブロックの props と同じ）。templateId は "" なら既定のテンプレート、"none" ならテンプレートを使わない。align は "right" で右に寄せる */
export type AddButtonProps = { dbId: string; templateId: string; label: string; align: string };

/** 足す先のデータベース。選んでいなければ、依頼のデータベース（無ければ最初のもの） */
const targetOf = (databases: Database[], dbId: string) => (dbId ? databases.find((d) => d.id === dbId) : (databases.find((d) => d.kind === "request") ?? databases[0]));

const templateOf = (database: Database | undefined, templateId: string) =>
  !database || templateId === "none" ? undefined : database.templates?.find((t) => t.id === (templateId || database.defaultTemplateId));

/** 押すと、データベースにページを足す画面を出すボタン（ホームの「依頼を追加」） */
export function AddButtonView({ props, onChange }: { props: AddButtonProps; onChange: (patch: Partial<AddButtonProps>) => void }) {
  const ctx = useNoteContext();
  const databases = useDatabases(ctx.roomId) ?? [];
  const database = targetOf(databases, props.dbId);
  const [adding, setAdding] = useState(false);
  const label = props.label || (database ? `${database.kind === "request" ? "依頼" : "ページ"}を追加` : "追加");

  return (
    <div className={`flex w-full items-center gap-1 ${props.align === "right" ? "justify-end" : ""}`} contentEditable={false} data-name="追加ボタン">
      <button className="btn" disabled={!database} onClick={() => setAdding(true)} title={database ? `「${database.name}」に足す` : "歯車からデータベースを選んでください"}>
        <Icon name="add" />
        {label}
      </button>
      {!ctx.locked && (
        <SettingsButton label="追加ボタンの設定">
          <AddButtonMenu props={props} databases={databases} database={database} onChange={onChange} />
        </SettingsButton>
      )}
      {adding && database && (
        <NewPageDialog database={database} members={ctx.members} userId={ctx.userId} template={templateOf(database, props.templateId)} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

/** 追加ボタンの設定：ボタンの文字・ソース（足す先のデータベース）・テンプレート・右に寄せる */
function AddButtonMenu({ props, databases, database, onChange }: { props: AddButtonProps; databases: Database[]; database?: Database; onChange: (patch: Partial<AddButtonProps>) => void }) {
  const [screen, setScreen] = useState<"top" | "source" | "template">("top");
  const top = () => setScreen("top");
  const fallback = database ? database.templates?.find((t) => t.id === database.defaultTemplateId) : undefined;
  const templateText = props.templateId === "none" ? "使わない" : (templateOf(database, props.templateId)?.name ?? (props.templateId ? "見つかりません" : "使わない"));

  if (screen === "source")
    return (
      <ChoiceScreen
        title="ソース"
        section="ページを足すデータベース"
        items={databases.map((d) => ({ id: d.id, label: d.name, icon: "db" as const, emoji: d.icon }))}
        selected={database?.id ?? ""}
        // データベースを変えたら、テンプレートはそのデータベースの既定に戻す
        onPick={(id) => {
          onChange({ dbId: id, templateId: "" });
          top();
        }}
        onBack={top}
      />
    );
  if (screen === "template" && database)
    return (
      <ChoiceScreen
        title="テンプレート"
        items={[
          { id: "", label: `既定のテンプレート${fallback ? `（${fallback.name}）` : "（なし）"}`, icon: "star" as const },
          { id: "none", label: "テンプレートを使わない", icon: "x" as const },
          ...(database.templates ?? []).map((t) => ({ id: t.id, label: t.name, icon: "note" as const, emoji: t.icon })),
        ]}
        selected={props.templateId}
        onPick={(id) => {
          onChange({ templateId: id });
          top();
        }}
        onBack={top}
      />
    );
  return (
    <div>
      <MenuTitle>追加ボタンの設定</MenuTitle>
      <TextField label="ボタンの文字" defaultValue={props.label} onChange={(label) => onChange({ label })} placeholder={database ? `${database.kind === "request" ? "依頼" : "ページ"}を追加` : "追加"} />
      <NavRow icon="db" label="ソース" value={database?.name ?? "選んでいません"} onClick={() => setScreen("source")} />
      <NavRow icon="note" label="テンプレート" value={templateText} onClick={() => setScreen("template")} disabled={!database} />
      <ToggleRow icon="r" label="右に寄せる" on={props.align === "right"} onChange={(on) => onChange({ align: on ? "right" : "" })} />
    </div>
  );
}
