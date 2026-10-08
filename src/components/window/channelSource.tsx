"use client";

import type { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { MenuDivider, MenuItem, MenuLabel } from "@/components/ui/Popover";
import { choose, promptText } from "@/components/ui/overlay";
import { editHref } from "@/components/window/editMode";
import { countTemplateUses, createTemplateFrom, linkTemplate, unlinkTemplate, useChannelTemplates, type ChannelTemplate, type TemplateKind } from "@/lib/local/channelTemplates";

/** ソース（テンプレート）を選べるもの：ウィンドウ・ノートのチャンネル */
export type SourceTarget = { kind: TemplateKind; id: string; name: string; sourceId?: string | null };

const KIND_LABEL: Record<TemplateKind, string> = { window: "ウィンドウ", note: "ノート" };

/**
 * 編集モードで開く。テンプレートと繋いでいれば、テンプレートを直すか、分けて（ここだけの内容にして）直すかを選ぶ。
 * 繋いでいないノートは、いつでも書けるので、そのまま開く
 */
export async function openSourceEdit(target: SourceTarget, href: string, router: ReturnType<typeof useRouter>) {
  if (target.sourceId) {
    const uses = await countTemplateUses(target.kind, target.sourceId);
    const k = await choose("テンプレートと繋がっています", [
      { label: "テンプレートを編集", detail: uses > 1 ? `同じテンプレートを使っている${uses}個（ここも含む）すべてに反映されます` : "テンプレートの中身が変わります" },
      { label: "分けて編集", detail: "今の内容をコピーして、ここだけの内容にしてから編集します。テンプレートとの繋がりは外れて、ソースは「選択なし」になります" },
    ]);
    if (k === null) return;
    if (k === 1) {
      await unlinkTemplate(target.kind, target.id);
      // ノートは、繋がりを外せばいつでも書ける
      if (target.kind === "note") return router.push(href);
    }
  }
  router.push(editHref(href));
}

/** 右クリックのメニューの「ソース」の右に出す、今のソース（テンプレートの名前か「選択なし」） */
export function SourceName({ roomId, sourceId }: { roomId: string; sourceId?: string | null }) {
  const templates = useChannelTemplates(roomId);
  const name = sourceId ? templates?.find((t) => t.id === sourceId)?.name : undefined;
  return <span className="max-w-28 truncate text-xs text-muted">{sourceId ? (name ?? "") : "選択なし"}</span>;
}

/** 新しいチャンネルを作るとき：テンプレートを使うか（テンプレートが無ければ聞かない）。undefined は使わない、null はやめる */
export async function pickTemplateForNew(templates: ChannelTemplate[], kind: TemplateKind): Promise<ChannelTemplate | undefined | null> {
  const list = templates.filter((t) => t.kind === kind);
  if (!list.length) return undefined;
  const k = await choose(`${KIND_LABEL[kind]}のテンプレート`, [{ label: "使わない（空から作る）" }, ...list.map((t) => ({ label: t.name, detail: `${t.uses}個で使用中。中身はこのテンプレートと繋がります` }))]);
  if (k === null) return null;
  return k === 0 ? undefined : list[k - 1];
}

/**
 * ソース：ルームのテンプレート（同じ種類のもの）から選ぶか、「選択なし」。
 * 「選択なし」からテンプレートを選ぶときは、今の内容が消えるので、置き換えるか・今の内容をテンプレートにして繋ぐかを聞く
 */
export function SourceMenu({ target, roomId, close }: { target: SourceTarget; roomId: string; close: () => void }) {
  const { kind } = target;
  const templates = (useChannelTemplates(roomId) ?? []).filter((t) => t.kind === kind);
  const what = KIND_LABEL[kind];
  const askName = () => promptText("新しいテンプレート", `${target.name || "無題"}のテンプレート`, "テンプレートの名前");
  const fromCurrent = async () => {
    close();
    const name = await askName();
    if (name) await createTemplateFrom(kind, target.id, name);
  };
  const pick = async (t: ChannelTemplate) => {
    close();
    if (t.id === target.sourceId) return;
    // 別のテンプレートと繋いでいたなら、そのまま入れ替える（ここだけの内容は無いので、消えるものは無い）
    if (target.sourceId) return void (await linkTemplate(kind, target.id, t.id));
    const k = await choose(
      `ソースを「${t.name}」にします`,
      [
        { label: "テンプレートの内容に置き換える", detail: `今の${what}の内容は削除されます` },
        { label: "今の内容を新しいテンプレートにして繋ぐ", detail: `今の内容は消えずに新しいテンプレートになり、それをソースにします（「${t.name}」は使いません）` },
      ],
      `今の${what}の内容が削除されますが、大丈夫ですか？`,
    );
    if (k === 0) await linkTemplate(kind, target.id, t.id);
    if (k === 1) {
      const name = await askName();
      if (name) await createTemplateFrom(kind, target.id, name);
    }
  };
  return (
    <div>
      <MenuLabel>「{target.name || "無題"}」のソース（テンプレート）</MenuLabel>
      {/* 「選択なし」にすると、今出ている内容をコピーして、ここだけの内容にする（消えない） */}
      <MenuItem active={!target.sourceId} onClick={() => (close(), target.sourceId && void unlinkTemplate(kind, target.id))}>
        選択なし
      </MenuItem>
      {templates.map((t) => (
        <MenuItem key={t.id} active={target.sourceId === t.id} icon={<Icon name="copy" size={16} />} onClick={() => void pick(t)} right={<span className="text-xs text-muted">{t.uses}個で使用中</span>}>
          {t.name}
        </MenuItem>
      ))}
      {!templates.length && <p className="px-2 py-1 text-xs text-muted">{what}のテンプレートはまだありません</p>}
      <MenuDivider />
      <MenuItem icon={<Icon name="add" size={16} />} onClick={() => void fromCurrent()}>
        今の内容から新しいテンプレートを作る
      </MenuItem>
    </div>
  );
}
