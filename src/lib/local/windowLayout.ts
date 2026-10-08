import { newId } from "@/lib/id";
import type { BlockKind, DbView, PageTemplate, WinLeaf, WinNode, WinSplit, WindowItem, WindowTab } from "./db";

// ウィンドウの並び方（Notion の列のように、上下・左右に分けていく木）。データベースに依存しない計算だけを置く

/** 置く位置：部品の左・右・上・下に分けて置くか、中央（タブにまとめる） */
export type Zone = "left" | "right" | "top" | "bottom" | "center";

const dirOf = (z: Zone): WinSplit["dir"] => (z === "left" || z === "right" ? "row" : "col");
const before = (z: Zone) => z === "left" || z === "top";
const norm = (sizes: number[]) => {
  const sum = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((s) => s / sum);
};

export const newLeaf = (tabs: WindowTab[], active?: string): WinLeaf => ({ kind: "leaf", id: newId(), tabs, active: active ?? tabs[0]?.id });
export const activeOf = (l: WinLeaf) => l.tabs.find((t) => t.id === l.active) ?? l.tabs[0];

/** 中身が小さいので、はじめから高さを中身に合わせるブロック（pageProp は前の「ページの項目（1つ）」） */
const FIT_KINDS = new Set<string>(["pageTitle", "pageProgress", "pageProp"]);

/** 上下に並べたとき、高さを中身に合わせるか（合わせないものは、残りの高さを比率で分ける） */
export const leafFit = (l: WinLeaf) => l.fit ?? (l.tabs.length === 1 && FIT_KINDS.has(l.tabs[0].type));
/** 分けたところは、中が全部「中身に合わせる」なら合わせる */
export const nodeFit = (n: WinNode): boolean => (n.kind === "leaf" ? leafFit(n) : n.children.every(nodeFit));

/** 左上から順に、部品（葉）を全部 */
export function leavesOf(node: WinNode | null | undefined): WinLeaf[] {
  if (!node) return [];
  return node.kind === "leaf" ? [node] : node.children.flatMap(leavesOf);
}

export function findLeaf(node: WinNode | null | undefined, id: string): WinLeaf | undefined {
  return leavesOf(node).find((l) => l.id === id);
}

/** その ID の部品・分けたところがあるか */
export function hasNode(node: WinNode | null | undefined, id: string): boolean {
  if (!node) return false;
  return node.id === id || (node.kind === "split" && node.children.some((c) => hasNode(c, id)));
}

/** 部品1つを書き換える */
export function mapLeaf(node: WinNode, id: string, fn: (l: WinLeaf) => WinLeaf): WinNode {
  if (node.kind === "leaf") return node.id === id ? fn(node) : node;
  return { ...node, children: node.children.map((c) => mapLeaf(c, id, fn)) };
}

/** 分け方1つの比率を変える */
export function setSizes(node: WinNode, splitId: string, sizes: number[]): WinNode {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, sizes: norm(sizes) };
  return { ...node, children: node.children.map((c) => setSizes(c, splitId, sizes)) };
}

/** 部品（または分け方）を取り除く。1つだけになった分け方は、中身だけにする */
export function removeNode(node: WinNode, id: string): WinNode | null {
  if (node.id === id) return null;
  if (node.kind === "leaf") return node;
  const kept: { c: WinNode; s: number }[] = [];
  node.children.forEach((c, i) => {
    const n = removeNode(c, id);
    if (n) kept.push({ c: n, s: node.sizes[i] });
  });
  if (!kept.length) return null;
  if (kept.length === 1) return kept[0].c;
  return { ...node, children: kept.map((k) => k.c), sizes: norm(kept.map((k) => k.s)) };
}

/** タブを1つ取り出す。部品のタブが無くなったら、部品ごと取り除く */
export function takeTab(root: WinNode, leafId: string, tabId: string): { root: WinNode | null; tab: WindowTab | null } {
  const leaf = findLeaf(root, leafId);
  const tab = leaf?.tabs.find((t) => t.id === tabId) ?? null;
  if (!leaf || !tab) return { root, tab: null };
  if (leaf.tabs.length === 1) return { root: removeNode(root, leafId), tab };
  const rest = leaf.tabs.filter((t) => t.id !== tabId);
  return { root: mapLeaf(root, leafId, (l) => ({ ...l, tabs: rest, active: l.active === tabId ? rest[0].id : l.active })), tab };
}

/** target の zone 側に部品を置く。同じ向きの分け方の中なら隣に並べ、違えば target を2つに分ける */
export function insertAt(root: WinNode | null, targetId: string, zone: Zone, leaf: WinLeaf): WinNode {
  if (!root) return leaf;
  if (zone === "center") {
    return mapLeaf(root, targetId, (l) => ({ ...l, tabs: [...l.tabs, ...leaf.tabs], active: leaf.active ?? leaf.tabs[0]?.id }));
  }
  const dir = dirOf(zone);
  const wrap = (n: WinNode): WinSplit => ({ kind: "split", id: newId(), dir, children: before(zone) ? [leaf, n] : [n, leaf], sizes: [0.5, 0.5] });
  if (root.id === targetId) return wrap(root);
  const walk = (n: WinNode): WinNode => {
    if (n.kind === "leaf") return n;
    const i = n.children.findIndex((c) => c.id === targetId);
    if (i >= 0 && n.dir === dir) {
      const half = n.sizes[i] / 2;
      const at = before(zone) ? i : i + 1;
      const children = [...n.children];
      const sizes = [...n.sizes];
      sizes[i] = half;
      children.splice(at, 0, leaf);
      sizes.splice(at, 0, half);
      return { ...n, children, sizes };
    }
    if (i >= 0) return { ...n, children: n.children.map((c, k) => (k === i ? wrap(c) : c)) };
    return { ...n, children: n.children.map(walk) };
  };
  return walk(root);
}

/** いちばん下に部品を足す（Notion でブロックを足すのと同じ） */
export function appendBottom(root: WinNode | null, leaf: WinLeaf): WinNode {
  if (!root) return leaf;
  if (root.kind === "split" && root.dir === "col") {
    const n = root.children.length;
    return { ...root, children: [...root.children, leaf], sizes: [...root.sizes.map((s) => (s * n) / (n + 1)), 1 / (n + 1)] };
  }
  return { kind: "split", id: newId(), dir: "col", children: [root, leaf], sizes: [0.65, 0.35] };
}

/** 全部のタブを書き換える */
export function mapTabs(node: WinNode, fn: (t: WindowTab) => WindowTab): WinNode {
  if (node.kind === "leaf") return { ...node, tabs: node.tabs.map(fn) };
  return { ...node, children: node.children.map((c) => mapTabs(c, fn)) };
}

const OLD_KIND: Record<string, BlockKind> = { image: "mediaImage", all: "dbView", single: "singleView", chat: "chatBlock", imageChat: "imageChatBlock" };

/** 前の部品（テキスト・画像など）を、ノートのブロックと同じ形にする。もう同じ形ならそのまま */
export function toBlockTab(t: { id: string; type: string; props: Record<string, string>; blocks?: unknown[] }): WindowTab {
  if (OLD_KIND[t.type]) return { id: t.id, type: OLD_KIND[t.type], props: t.props };
  if (t.type === "text" && !t.blocks) {
    // 前のテキストは1行ずつ段落に（大・特大だったものは見出しに）
    const level = t.props.size === "xl" ? 1 : t.props.size === "l" ? 2 : 0;
    const lines = (t.props.text ?? "").split("\n");
    const blocks = lines.map((line) => (level ? { type: "heading", props: { level }, content: line } : { type: "paragraph", content: line }));
    return { id: t.id, type: "text", props: {}, blocks };
  }
  return t as WindowTab;
}

// ---- 前のマス目の配置から作り直す ----

type R = Pick<WindowItem, "x" | "y" | "w" | "h">;

/** マス目に置いていた部品を、縦横に切り分けられるところで切って木にする */
export function fromGrid(items: WindowItem[]): WinNode | null {
  if (!items.length) return null;
  const leafOf = (it: WindowItem): WinLeaf => {
    const tabs = (it.tabs ?? [{ id: it.id, type: it.type, props: it.props }]).map(toBlockTab);
    return { kind: "leaf", id: it.id, tabs, active: it.active ?? tabs[0].id };
  };
  const build = (list: WindowItem[]): WinNode => {
    if (list.length === 1) return leafOf(list[0]);
    for (const dir of ["row", "col"] as const) {
      const lo = (r: R) => (dir === "row" ? r.x : r.y);
      const hi = (r: R) => (dir === "row" ? r.x + r.w : r.y + r.h);
      const cuts = [...new Set(list.map(hi))].sort((a, b) => a - b);
      const groups: WindowItem[][] = [];
      let rest = [...list];
      for (const c of cuts) {
        const left = rest.filter((r) => hi(r) <= c);
        if (left.length && left.length < rest.length && rest.every((r) => hi(r) <= c || lo(r) >= c)) {
          groups.push(left);
          rest = rest.filter((r) => hi(r) > c);
        }
      }
      if (groups.length) {
        groups.push(rest);
        const span = (g: WindowItem[]) => Math.max(...g.map(hi)) - Math.min(...g.map(lo));
        return { kind: "split", id: newId(), dir, children: groups.map(build), sizes: norm(groups.map(span)) };
      }
    }
    // 切り分けられないときは、上から順に縦に並べる
    const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
    return { kind: "split", id: newId(), dir: "col", children: sorted.map(leafOf), sizes: norm(sorted.map((r) => r.h)) };
  };
  return build(items);
}

// ---- 前の並べ方を、ブロックの並び（ノートと同じ形）に作り直す ----

type B = { type: string; props?: Record<string, unknown>; content?: unknown; children?: B[] };

/** タブ1つ分を、ブロックの並びにする */
function tabToBlocks(t: WindowTab): B[] {
  if (t.type === "text") return (t.blocks ?? []) as B[];
  // ページのタイトル → このページのタイトルと繋いだ見出し
  if (t.type === "pageTitle") return [{ type: "field", props: { level: "1", dbId: "", pageId: "@this", propId: "title", suffix: t.props.suffix ?? "" } }];
  // ページのチャット → このページのチャットの項目を出すシングルビュー
  if (t.type === "pageChat") return [{ type: "singleView", props: { dbId: "", pageId: "@this", propId: t.props.which === "reenact" ? "p_reenact" : "p_chat", display: "value" } }];
  const { title: _title, ...props } = t.props;
  void _title;
  return [{ type: t.type, props }];
}

/** 列の中には列を入れられないので、中の列はほどいて縦に並べる */
const unnest = (blocks: B[]): B[] => blocks.flatMap((b) => (b.type === "columnList" ? (b.children ?? []).flatMap((c) => unnest(c.children ?? [])) : [b]));

/** 前の並べ方（上下・左右に分けた木）を、ブロックの並びにする。左右に分けたところは列になる。タブは縦に並べる */
export function layoutToBlocks(node: WinNode | null | undefined): unknown[] {
  const walk = (n: WinNode): B[] => {
    if (n.kind === "leaf") return n.tabs.flatMap(tabToBlocks);
    if (n.dir === "col") return n.children.flatMap(walk);
    const columns = n.children.map((c, i) => {
      const inner = unnest(walk(c));
      return { type: "column", props: { width: Math.round((n.sizes[i] ?? 1 / n.children.length) * n.children.length * 100) / 100 }, children: inner.length ? inner : [{ type: "paragraph" }] };
    });
    return [{ type: "columnList", children: columns }];
  };
  return node ? walk(node) : [];
}

// ---- 前の「ページの項目（1つ）」を「ページの項目」にまとめる ----

/** 「ページの項目（1つ）」のブロックを、その項目だけを出す「ページの項目」にする（子の中も）。1つも無ければ同じ並びを返す */
export function mergePageProp(blocks: unknown[]): unknown[] {
  let changed = false;
  const walk = (list: B[]): B[] =>
    list.map((b) => {
      let next = b;
      if (b.type === "pageProp") {
        changed = true;
        const propId = typeof b.props?.propId === "string" ? b.props.propId : "";
        next = { ...b, type: "pageProps", props: { heading: "", dbId: "", pageId: "@this", visible: JSON.stringify(propId ? [propId] : []) } };
      }
      return next.children?.length ? { ...next, children: walk(next.children) } : next;
    });
  const out = walk(blocks as B[]);
  return changed ? out : blocks;
}

// ---- 前の「進み具合と工程」を、同じ見た目のシングルビューにする ----

/**
 * 「進み具合と工程」と同じ見た目のシングルビュー（このページの工程をラインゲージにして、納期とステータスを一緒に出し、
 * 工程の期限と納期までの日数を出す。見出しは出さない）。props は、そのデータベースにある項目の ID
 */
export function progressSingleView(ids: { stage?: string; progress?: string; due?: string; status?: string }): B {
  const main = ids.stage ?? ids.progress ?? "";
  return {
    type: "singleView",
    props: {
      dbId: "",
      pageId: "@this",
      propId: main,
      display: "line",
      visible: JSON.stringify([ids.due, ids.status].filter(Boolean)),
      stages: JSON.stringify(ids.stage ? [ids.stage] : []),
      countdown: JSON.stringify(ids.due ? [ids.due] : []),
      hideHead: "1",
    },
  };
}

/** 「進み具合と工程」のブロックを、同じ見た目のシングルビューにする（子の中も）。1つも無ければ同じ並びを返す */
export function replaceProgress(blocks: unknown[], ids: Parameters<typeof progressSingleView>[0]): unknown[] {
  let changed = false;
  const walk = (list: B[]): B[] =>
    list.map((b) => {
      let next = b;
      if (b.type === "pageProgress") {
        changed = true;
        next = { ...progressSingleView(ids), ...("id" in b ? { id: (b as { id?: string }).id } : {}) } as B;
      }
      return next.children?.length ? { ...next, children: walk(next.children) } : next;
    });
  const out = walk(blocks as B[]);
  return changed ? out : blocks;
}

// ---- オールビュー（Notion のリンクされたビュー）のビュー ----

/** オールビューのブロックが持つビュー1つ（データベースのビューと同じ中身。データベースとは別に持つ） */
export type BlockView = Pick<DbView, "id" | "name" | "type" | "filters" | "sort" | "options">;

/** データベースのビューを、ブロックが持つビューとしてコピーする（ID は新しくする） */
export const copyView = (v: Pick<DbView, "name" | "type" | "filters" | "sort" | "options">): BlockView => ({
  id: newId(),
  name: v.name,
  type: v.type,
  filters: v.filters ?? [],
  sort: v.sort ?? null,
  options: v.options ?? {},
});

/** オールビューのブロック（ビューを1つ持つ） */
export const dbViewBlock = (dbId: string, view: BlockView) => ({ type: "dbView", props: { dbId, views: JSON.stringify([view]), active: view.id } });

// ---- 前のホームの中身 ----

/**
 * 前のホームの最初の中身。画面に収まるように、
 * 上に3列で今の依頼（リスト）・収入（集計）・追加ボタンと ToDo、下にタイムラインとカレンダーをタブで並べる
 */
export function homeBlocks(dbId: string | undefined, views: { list?: DbView; summary?: DbView; timeline?: DbView; calendar?: DbView }): unknown[] {
  if (!dbId) return [{ type: "todoBlock" }];
  // データベースのビューをコピーして、それぞれのオールビューが持つ（無ければ表）
  const view = (v: DbView | undefined) => dbViewBlock(dbId, copyView(v ?? { name: "表", type: "table", filters: [], sort: null, options: {} }));
  const tabs = [views.timeline, views.calendar].filter(Boolean).map((v) => ({ id: newId(), ...view(v) }));
  return [
    {
      type: "columnList",
      children: [
        { type: "column", props: { width: 1.3 }, children: [view(views.list)] },
        { type: "column", props: { width: 1 }, children: [view(views.summary)] },
        { type: "column", props: { width: 0.9 }, children: [{ type: "addButton", props: { dbId, templateId: "", label: "", align: "right" } }, { type: "todoBlock" }] },
      ],
    },
    ...(tabs.length ? [{ type: "tabs", props: { active: tabs[0].id, titles: "{}" }, children: tabs }] : []),
  ];
}

// ---- 標準の依頼のテンプレート ----

/**
 * 今までの依頼ページと同じ中身のブロック。
 * 見出し（このページのタイトルと繋いで「〇〇様の依頼」）・進み具合と工程（シングルビュー）、その下に3列で
 * 依頼進行チャット・やり取り再現（チャットの項目のシングルビュー）・依頼の詳細
 */
export function standardRequestBlocks(): unknown[] {
  const chat = (propId: string) => ({ type: "singleView", props: { dbId: "", pageId: "@this", propId, display: "value" } });
  return [
    { type: "field", props: { level: "1", dbId: "", pageId: "@this", propId: "title", suffix: "様の依頼" } },
    progressSingleView({ stage: "p_stage", due: "p_due", status: "p_status" }),
    {
      type: "columnList",
      children: [
        { type: "column", props: { width: 1.3 }, children: [chat("p_chat")] },
        { type: "column", props: { width: 1.1 }, children: [chat("p_reenact")] },
        { type: "column", props: { width: 0.9 }, children: [{ type: "pageProps", props: { heading: "依頼の詳細" } }] },
      ],
    },
  ];
}

export function standardRequestTemplate(): PageTemplate {
  return { id: newId(), name: "標準の依頼", kind: "window", values: {}, blocks: standardRequestBlocks(), createdAt: Date.now() };
}
