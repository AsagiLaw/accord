"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { MenuDivider, MenuItem, MenuLabel } from "@/components/ui/Popover";
import { choose, promptText, toast } from "@/components/ui/overlay";
import { editHref } from "@/components/window/editMode";
import type { Database, DbPage, PageTemplate } from "@/lib/local/db";
import { TRASH_DAYS, duplicatePage, restorePage, trashPage, usePages } from "@/lib/local/requests";
import { useCurrentUser } from "@/lib/local/session";
import { applyNoteTemplate, createTemplateFromPage, linkPageTemplate, templateOf, unlinkPageTemplate } from "@/lib/local/templates";
import { usePeek } from "./PageLink";
import { pageHref } from "./views/common";

/**
 * ページを右クリックしたときのメニュー（サイドバー・表）：開く（onOpen があるとき）、編集、ソース（テンプレート）、複製、ゴミ箱に入れる。
 * ページの画面の右上には編集・削除のボタンを置かないので、ここから行う
 */
export function PageMenu({
  database,
  page,
  close,
  onOpen,
  onDeleted,
}: {
  database: Database;
  page: DbPage;
  close: () => void;
  onOpen?: () => void;
  /** 消す前に呼ぶ（そのページを開いていたら、データベースの画面へ移るなど） */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const me = useCurrentUser();
  const peek = usePeek();
  const pages = usePages(database.id) ?? [];
  const [screen, setScreen] = useState<"main" | "source">("main");
  const label = "ページ";
  const href = pageHref(database, page.id);
  const template = templateOf(database, page);
  const usesOf = (t: PageTemplate) => pages.filter((p) => p.sourceId === t.id).length;
  const title = page.title || "無題";

  // 編集：テンプレートと繋いでいれば、テンプレートを直すか、分けて（このページだけの本文にして）直すかを選ぶ
  const edit = async () => {
    close();
    if (template) {
      const uses = usesOf(template);
      const k = await choose("テンプレートと繋がっています", [
        { label: "テンプレートを編集", detail: `${uses > 1 ? `同じテンプレートを使っている${uses}個（ここも含む）すべてに反映されます。` : ""}テンプレートの画面で直します` },
        { label: "分けて編集", detail: `今の本文をコピーして、この${label}だけの本文にしてから編集します。テンプレートとの繋がりは外れて、ソースは「選択なし」になります` },
      ]);
      if (k === null) return;
      if (k === 0) return router.push(`/r/${database.roomId}/db/${database.id}/t/${template.id}`);
      await unlinkPageTemplate(database, page);
      // ノート型は、繋がりを外せばいつでも書ける
      return router.push(template.kind === "window" ? editHref(href) : href);
    }
    router.push(editHref(href));
  };

  if (screen === "source") return <PageSourceMenu database={database} page={page} close={close} usesOf={usesOf} />;
  return (
    <div>
      <MenuLabel>
        {label}「{title}」
      </MenuLabel>
      {onOpen && (
        <MenuItem icon={<Icon name="open" size={16} />} onClick={() => (close(), onOpen())}>
          開く
        </MenuItem>
      )}
      {/* 編集モードがあるのは、ウィンドウ型のページと、テンプレートと繋いだページ（ノート型はふだんから書ける） */}
      {(page.bodyKind === "window" || template) && (
        <MenuItem icon={<Icon name="window" size={16} />} onClick={() => void edit()}>
          編集
        </MenuItem>
      )}
      <MenuItem icon={<Icon name="copy" size={16} />} onClick={() => setScreen("source")} right={<span className="max-w-28 truncate text-xs text-muted">{template ? template.name : "選択なし"}</span>}>
        ソース
      </MenuItem>
      <MenuItem
        icon={<Icon name="duplicate" size={16} />}
        onClick={async () => {
          close();
          if (!me) return;
          const copy = await duplicatePage(page, me.id);
          if (copy) toast(`「${copy.title || "無題"}」を作りました`, { label: "開く", run: () => peek(database, copy.id) });
        }}
      >
        複製
      </MenuItem>
      <MenuDivider />
      <MenuItem
        icon={<Icon name="del" size={16} />}
        danger
        onClick={async () => {
          close();
          onDeleted?.();
          await trashPage(page);
          toast(`「${title}」をゴミ箱に入れました（${TRASH_DAYS}日後に完全に削除）`, { label: "元に戻す", run: () => void restorePage(page.id) });
        }}
      >
        ゴミ箱に入れる
      </MenuItem>
    </div>
  );
}

/**
 * ページのソース：このデータベースのテンプレートから選ぶか、「選択なし」。
 * ウィンドウ型のテンプレートは繋ぐ。「選択なし」から選ぶときは、今の本文が消えるので、置き換えるか・今の本文をテンプレートにして繋ぐかを聞く。
 * ノート型のテンプレートは繋がず、同じブロックを本文に入れるだけ（置き換えるか、下に足すかを聞く）
 */
function PageSourceMenu({ database, page, close, usesOf }: { database: Database; page: DbPage; close: () => void; usesOf: (t: PageTemplate) => number }) {
  const templates = database.templates ?? [];
  const label = "ページ";
  const askName = () => promptText("新しいテンプレート", `${page.title || "無題"}のテンプレート`, "テンプレートの名前");
  const fromCurrent = async () => {
    close();
    const name = await askName();
    if (name) await createTemplateFromPage(database, page, name);
  };
  const putNote = async (t: PageTemplate) => {
    const k = await choose(`「${t.name}」のブロックを入れます`, [
      { label: "本文を置き換える", detail: `今の${label}の本文は削除されます（項目の値やチャットは消えません）` },
      { label: "本文の下に足す", detail: "今の本文は残して、その下にブロックを足します" },
    ]);
    if (k !== null) await applyNoteTemplate(page, t, k === 0 ? "replace" : "append");
  };
  const pick = async (t: PageTemplate) => {
    close();
    if (t.kind === "note") return void (await putNote(t));
    if (t.id === page.sourceId) return;
    // 別のテンプレートと繋いでいたなら、そのまま入れ替える（このページだけの本文は無いので、消えるものは無い）
    if (page.sourceId) return void (await linkPageTemplate(page, t));
    const k = await choose(
      `ソースを「${t.name}」にします`,
      [
        { label: "テンプレートの内容に置き換える", detail: `今の${label}の本文は削除されます（項目の値やチャットは消えません）` },
        // 今の内容をテンプレートにして繋げるのは、ウィンドウ型のページだけ（ノート型のテンプレートは繋がない）
        ...(page.bodyKind === "window" ? [{ label: "今の内容を新しいテンプレートにして繋ぐ", detail: `今の本文は消えずに新しいテンプレートになり、それをソースにします（「${t.name}」は使いません）` }] : []),
      ],
      `今の${label}の本文が削除されますが、大丈夫ですか？`,
    );
    if (k === 0) await linkPageTemplate(page, t);
    if (k === 1) {
      const name = await askName();
      if (name) await createTemplateFromPage(database, page, name);
    }
  };
  return (
    <div>
      <MenuLabel>「{page.title || "無題"}」のソース（テンプレート）</MenuLabel>
      {/* 「選択なし」にすると、今出ている本文をコピーして、このページだけの本文にする（消えない） */}
      <MenuItem active={!page.sourceId} onClick={() => (close(), page.sourceId && void unlinkPageTemplate(database, page))}>
        選択なし
      </MenuItem>
      {templates.map((t) => (
        <MenuItem
          key={t.id}
          active={page.sourceId === t.id}
          icon={<Icon name={t.kind === "window" ? "window" : "note"} size={16} />}
          onClick={() => void pick(t)}
          // ノート型は繋がない（ブロックを入れるだけ）
          right={<span className="text-xs text-muted">{t.kind === "note" ? "ブロックを入れる" : `${usesOf(t)}個で使用中`}</span>}
        >
          {t.name}
        </MenuItem>
      ))}
      {!templates.length && <p className="px-2 py-1 text-xs text-muted">このデータベースのテンプレートはまだありません</p>}
      <MenuDivider />
      <MenuItem icon={<Icon name="add" size={16} />} onClick={() => void fromCurrent()}>
        今の本文から新しいテンプレートを作る
      </MenuItem>
    </div>
  );
}
