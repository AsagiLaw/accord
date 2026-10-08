"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuDivider, MenuItem, MenuLabel, Popover, usePopover } from "@/components/ui/Popover";
import { BackHead } from "@/components/ui/SettingsMenu";
import { choose, confirmAction, promptText } from "@/components/ui/overlay";
import type { Database, PageTemplate } from "@/lib/local/db";
import { createTemplate, deleteTemplate, duplicateTemplate, setDefaultTemplate, updateTemplate } from "@/lib/local/templates";
import { EmojiPicker } from "./meta";

export const TEMPLATE_KIND: Record<PageTemplate["kind"], { label: string; note: string; icon: "note" | "window" }> = {
  note: { label: "ノート型", note: "本文が下に伸びる（スクロールする）", icon: "note" },
  window: { label: "ウィンドウ型", note: "本文が画面に固定（編集モードで部品を並べる）", icon: "window" },
};

/**
 * 「追加」の横のテンプレートのメニュー。選ぶとそのテンプレートでページを作る。鉛筆で本文を編集、下で新規作成。
 * テンプレートを右クリックすると、押した位置に別のメニューで、既定・名前・アイコン・複製・削除（テンプレートの画面には置かない）
 */
export function TemplateMenu({ database, onPick, close }: { database: Database; onPick: (t: PageTemplate | null) => void; close: () => void }) {
  const router = useRouter();
  const list = database.templates ?? [];
  const label = "ページ";
  const edit = (id: string) => router.push(`/r/${database.roomId}/db/${database.id}/t/${id}`);
  // 右クリックしたテンプレートの操作：押した位置に、別のメニューを出す（サイドバーの右クリックと同じ）。アイコンは、そのメニューの中で選ぶ
  const ctx = usePopover();
  const [acting, setActing] = useState<{ id: string; icon?: boolean } | null>(null);
  const target = acting ? list.find((t) => t.id === acting.id) : undefined;
  const isDefault = !!target && database.defaultTemplateId === target.id;
  const actionMenu = ctx.anchor && target && (
    <Popover anchor={ctx.anchor} onClose={ctx.close} width={acting?.icon ? 340 : 240} nested label={`テンプレート「${target.name}」のメニュー`}>
      {acting?.icon ? (
        <>
          <BackHead title={`「${target.name}」のアイコン`} onBack={() => setActing({ id: target.id })} />
          <EmojiPicker
            onPick={(e) => (void updateTemplate(database.id, target.id, { icon: e }), ctx.close())}
            onRemove={target.icon ? () => (void updateTemplate(database.id, target.id, { icon: undefined }), ctx.close()) : undefined}
          />
        </>
      ) : (
        <>
          <MenuLabel>テンプレート「{target.name}」</MenuLabel>
          <MenuItem icon={<Icon name="edit" size={16} />} onClick={() => (ctx.close(), close(), edit(target.id))}>
            本文を編集
          </MenuItem>
          <MenuItem icon={<Icon name="star" size={16} />} active={isDefault} onClick={() => (ctx.close(), void setDefaultTemplate(database.id, isDefault ? null : target.id))}>
            {isDefault ? "既定を外す" : "既定にする"}
          </MenuItem>
          <MenuItem
            icon={<Icon name="text" size={16} />}
            onClick={async () => {
              ctx.close();
              const name = await promptText("テンプレートの名前", target.name, "名前");
              if (name) await updateTemplate(database.id, target.id, { name });
            }}
          >
            名前を変更
          </MenuItem>
          <MenuItem icon={<Icon name="smile" size={16} />} onClick={() => setActing({ id: target.id, icon: true })}>
            アイコンを変える
          </MenuItem>
          <MenuItem icon={<Icon name="copy" size={16} />} onClick={() => (ctx.close(), void duplicateTemplate(database.id, target.id))}>
            複製
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={<Icon name="del" size={16} />}
            danger
            onClick={async () => {
              ctx.close();
              if (!(await confirmAction(`テンプレート「${target.name}」を削除します`, "削除", `このテンプレートで作った${label}は消えません。繋がっている${label}は、今の本文のまま切り離されます。`))) return;
              await deleteTemplate(database.id, target.id);
            }}
          >
            削除
          </MenuItem>
        </>
      )}
    </Popover>
  );

  return (
    <div>
      <MenuLabel>テンプレートで{label}を追加</MenuLabel>
      {!list.length && <p className="px-2 pb-2 text-xs text-muted">まだありません。下の「新規テンプレート」で作れます。</p>}
      <MenuItem
        icon={<Icon name="add" size={16} />}
        onClick={() => {
          close();
          onPick(null);
        }}
      >
        <span className="block truncate">テンプレートを使わない</span>
        <span className="block truncate text-xs text-muted">いつもの形（本文はノート）</span>
      </MenuItem>
      {list.map((t) => (
        <div
          key={t.id}
          className="group flex items-center"
          onContextMenu={(e) => {
            setActing({ id: t.id });
            ctx.openAt(e);
          }}
        >
          <div className="min-w-0 flex-1">
            <MenuItem
              icon={t.icon ? <span>{t.icon}</span> : <Icon name={TEMPLATE_KIND[t.kind].icon} size={16} />}
              onClick={() => {
                close();
                onPick(t);
              }}
            >
              <span className="block truncate">
                {t.name}
                {database.defaultTemplateId === t.id && <span className="ml-1.5 rounded-full bg-tint px-1.5 text-xs">既定</span>}
              </span>
              <span className="block truncate text-xs text-muted">{TEMPLATE_KIND[t.kind].label}</span>
            </MenuItem>
          </div>
          <button
            aria-label={`テンプレート「${t.name}」を編集`}
            title="本文を編集"
            onClick={() => {
              close();
              edit(t.id);
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted hover:bg-tint hover:text-ink"
          >
            <Icon name="edit" size={15} />
          </button>
        </div>
      ))}
      {list.length > 0 && <p className="px-2 pt-1 text-xs text-muted">右クリックで、既定・名前・複製・削除</p>}
      <MenuDivider />
      <MenuItem
        icon={<Icon name="add" size={16} />}
        onClick={async () => {
          close();
          const kinds = ["note", "window"] as const;
          const i = await choose(
            "新規テンプレート",
            kinds.map((k) => ({ label: TEMPLATE_KIND[k].label, detail: TEMPLATE_KIND[k].note })),
            "本文の形を選んでください",
          );
          if (i === null) return;
          const name = await promptText("テンプレートの名前", "", "名前");
          if (!name) return;
          const t = await createTemplate(database.id, kinds[i], name);
          edit(t.id);
        }}
      >
        新規テンプレート
      </MenuItem>
      {actionMenu}
    </div>
  );
}
