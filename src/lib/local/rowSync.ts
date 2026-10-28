"use client";

import Dexie, { type Table, type Transaction } from "dexie";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { db, type Message } from "./db";
import { noticeOf } from "./chatNotify";
import { pushMessage } from "@/lib/push";
import { toast } from "@/components/ui/overlay";
import { forgetBlobUrls } from "@/lib/media/blob-url";
import { removeDeletedFiles, removeShrunkFiles } from "@/lib/media/remote";
import { dmChatId } from "./dm";
import { sb, supa } from "./sync";

// Supabase 版：ルームの中のもの（カテゴリー・チャット・発言・既読・イメージユーザー：2-2、発言のリアクション：0023、データベース・ページ・ビュー・予定・ToDo・ノート・ウィンドウ：2-3）を、
// 画像の情報・ライブラリー（2-4）を、行ごとに Supabase の synced_rows（0011・0013・0014）に写す。
// 置き場所は、ルーム・DM・ボックス（画像の情報とライブラリー）のどれか1つ。画像のファイルそのものは、まだ送らない（第3段階）。
// 画面や処理は今までどおりブラウザの中（IndexedDB）に書く。書いた行は Dexie のフックで拾い、書き終わってから Supabase に送る。
// ほかの人が書いた行は Realtime で届き、届かなかった分は「最後に読んだ時刻」より後の行だけを読み直す（全部は読まない）。
// 表を足すときは、TABLES・scopeOf・belongs と、synced_rows の tbl の決まり（SQL）に足す

const TABLES = ["categories", "chats", "messages", "reactions", "chatReads", "imageUsers", "databases", "dbPages", "dbViews", "events", "todos", "notes", "windows", "media", "libraries"] as const;
export type Tbl = (typeof TABLES)[number];

type Scope = { room_id: string; dm: null; box_id: null } | { room_id: null; dm: string[]; box_id: null } | { room_id: null; dm: null; box_id: string };
type ServerRow = { tbl: Tbl; id: string; room_id: string | null; dm: string[] | null; box_id: string | null; data: Record<string, unknown>; deleted: boolean; updated_at: string };

/** どこまで読んだかを覚えるときの、置き場所の名前（ルームは ID、ボックスは「box:ID」、DM はまとめて "dm"） */
const scopeKey = (r: { room_id: string | null; box_id: string | null }) => r.room_id ?? (r.box_id ? `box:${r.box_id}` : "dm");

type Row = Record<string, unknown>;
const tableOf = (tbl: Tbl) => db.table(tbl) as Table<Row, unknown>;

/** Supabase での行の ID（既読は「チャットの ID|人の ID」） */
const idOf = (tbl: Tbl, row: Row) => (tbl === "chatReads" ? `${row.chatId}|${row.userId}` : String(row.id));
/** ブラウザの中の主キー */
const keyOf = (tbl: Tbl, id: string) => (tbl === "chatReads" ? id.split("|") : id);

/** その行が、どのルームか・どの DM か。分からない（チャットがまだ無いなど）ときは null で、送らない */
async function scopeOf(tbl: Tbl, row: Row): Promise<Scope | null> {
  const room = (roomId: unknown): Scope | null => (typeof roomId === "string" && roomId ? { room_id: roomId, dm: null, box_id: null } : null);
  const dmOf = (dm: unknown): Scope | null => (Array.isArray(dm) && dm.length === 2 ? { room_id: null, dm: [...(dm as string[])].sort(), box_id: null } : null);
  const byChat = async (chatId: unknown) => {
    const chat = typeof chatId === "string" ? await db.chats.get(chatId) : undefined;
    return chat ? (room(chat.roomId) ?? dmOf(chat.dm)) : null;
  };
  switch (tbl) {
    case "categories":
    case "imageUsers":
    case "databases":
    case "dbPages":
    case "events":
    case "todos":
    case "notes":
    case "windows":
      return room(row.roomId);
    case "dbViews": {
      const database = typeof row.dbId === "string" ? await db.databases.get(row.dbId) : undefined;
      return room(database?.roomId);
    }
    case "media":
    case "libraries":
      return typeof row.boxId === "string" && row.boxId ? { room_id: null, dm: null, box_id: row.boxId } : null;
    case "chats":
      return room(row.roomId) ?? dmOf(row.dm);
    case "messages":
    case "reactions":
      return room(row.roomId) ?? (await byChat(row.chatId));
    case "chatReads":
      return byChat(row.chatId);
  }
}

// ---- 書いた行を送る ----

/** 送る前の行（同じ行は最後の形だけ送る）。null は消した行 */
const outbox = new Map<string, { tbl: Tbl; id: string; row: Row | null }>();
/** 送っている途中の行（届いた古い形で、書いたばかりの形を上書きしないため） */
const sending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 行ごとの、知っているいちばん新しい形の時刻（送って Supabase に届いた形・届いて書いた形）。
 * Realtime の知らせは遅れて届くことがあり、名前を変えた直後に、その前の整理などの古い形が届くと名前が戻ってしまうので、これより古い形は書かない
 */
const known = new Map<string, number>();

/** 時刻をマイクロ秒の数にする（Realtime と読み直しで書き方が違うことがあるので、文字のままでは比べない）。読めなければ null */
function microsOf(at: string | undefined): number | null {
  const m = at?.match(/^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/);
  if (!m) return null;
  const zone = !m[4] || m[4] === "Z" ? "Z" : m[4].length === 3 ? `${m[4]}:00` : m[4].replace(/^([+-]\d\d)(\d\d)$/, "$1:$2");
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (Number.isNaN(ms)) return null;
  return ms * 1000 + Number((m[3] ?? "").padEnd(6, "0").slice(0, 6));
}

function remember(rows: { tbl: Tbl; id: string; updated_at: string }[] | null) {
  for (const r of rows ?? []) {
    const at = microsOf(r.updated_at);
    if (at === null) continue;
    const k = `${r.tbl}:${r.id}`;
    if ((known.get(k) ?? -1) < at) known.set(k, at);
  }
}

/** Supabase から届いた行を書いている途中の印（その書き込みは送り返さない） */
const REMOTE = Symbol("remote");
const isRemote = (trans: Transaction) => !!(trans as unknown as Record<symbol, boolean>)[REMOTE];

/**
 * まだ Supabase に届いていない行（「表:ID」→ 消した行か）。送る前・送っている途中にサイトを閉じても、
 * 開き直したときに送り直せるよう、ブラウザ（localStorage）にも覚えておく。行の中身は覚えず、送り直すときにブラウザの中から読む
 */
let unsent: Record<string, boolean> = {};
const unsentKey = () => `accord:unsent:${me}`;

function loadUnsent() {
  try {
    unsent = JSON.parse(localStorage.getItem(unsentKey()) ?? "{}") ?? {};
  } catch {
    unsent = {};
  }
}
function saveUnsent() {
  try {
    if (Object.keys(unsent).length) localStorage.setItem(unsentKey(), JSON.stringify(unsent));
    else localStorage.removeItem(unsentKey());
  } catch {
    // 覚えられなくても、開いている間は送る（閉じたときに送りそこねると、送り直せないだけ）
  }
}
/** 届いた・送れないと決まった行を、覚えから外す（送っている間にまた書かれた行は残す） */
function settle(k: string) {
  if (outbox.has(k) || !(k in unsent)) return;
  delete unsent[k];
  saveUnsent();
  notifySend();
}

// ---- 送っている途中か（自分の発言に「送信中」「送れませんでした」を出す） ----

/** 決まりで断られた行（「表:ID」）。送り直しても届かないので、画面で知らせる。開き直しても出せるよう、ブラウザにも覚えておく */
let failed = new Set<string>();
/** つながらなくて、しばらくしてから送り直す行 */
const offline = new Set<string>();
const failedKey = () => `accord:failed:${me}`;

function loadFailed() {
  try {
    failed = new Set(JSON.parse(localStorage.getItem(failedKey()) ?? "[]") as string[]);
  } catch {
    failed = new Set();
  }
}
function setFailed(k: string, on: boolean) {
  if (failed.has(k) === on) return;
  if (on) failed.add(k);
  else failed.delete(k);
  try {
    if (failed.size) localStorage.setItem(failedKey(), JSON.stringify([...failed]));
    else localStorage.removeItem(failedKey());
  } catch {
    // 覚えられなくても、開いている間は出せる
  }
}

const sendListeners = new Set<() => void>();
function notifySend() {
  sendListeners.forEach((f) => f());
}
export function subscribeSendState(f: () => void) {
  sendListeners.add(f);
  return () => void sendListeners.delete(f);
}

/** 書いた行が Supabase に届いたか。sending：送っている途中／offline：つながらないので待っている／failed：断られた／undefined：届いた（Supabase 版でないときも） */
export type SendState = "sending" | "offline" | "failed" | undefined;
export function sendStateOf(tbl: Tbl, id: string): SendState {
  const k = `${tbl}:${id}`;
  if (failed.has(k)) return "failed";
  if (offline.has(k)) return "offline";
  return k in unsent ? "sending" : undefined;
}

/** 断られた行を、今のブラウザの中の形で送り直す */
export async function resendRows(rows: { tbl: Tbl; id: string }[]) {
  for (const { tbl, id } of rows) {
    const row = await tableOf(tbl).get(keyOf(tbl, id) as never);
    if (row) enqueue(tbl, id, row);
    else setFailed(`${tbl}:${id}`, false);
  }
  notifySend();
}

/** 前に開いていたときに送りそこねた行を、今のブラウザの中の形で送り直す */
async function resendUnsent() {
  for (const [k, gone] of Object.entries(unsent)) {
    const at = k.indexOf(":");
    const tbl = k.slice(0, at) as Tbl;
    const id = k.slice(at + 1);
    if (!(TABLES as readonly string[]).includes(tbl)) {
      delete unsent[k];
      continue;
    }
    const row = await tableOf(tbl).get(keyOf(tbl, id) as never);
    if (row) enqueue(tbl, id, row);
    else if (gone) enqueue(tbl, id, null);
    // 書いた行がもう無い：あとで消していれば、その消した行も覚えている
    else delete unsent[k];
  }
  saveUnsent();
}

function enqueue(tbl: Tbl, id: string, row: Row | null) {
  const k = `${tbl}:${id}`;
  // ほかの人の既読は送らない（自分の分しか書けないので、いつも断られる）。前に覚えた分も忘れる
  if (tbl === "chatReads" && id.slice(id.indexOf("|") + 1) !== me) {
    setFailed(k, false);
    if (k in unsent) {
      delete unsent[k];
      saveUnsent();
    }
    return;
  }
  outbox.set(k, { tbl, id, row });
  // 書き直した行は、また送ってみる
  setFailed(k, false);
  if (unsent[k] !== !row) {
    unsent[k] = !row;
    saveUnsent();
  }
  notifySend();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), 200);
}

/** 行が Supabase に届いたあと：自分の発言は通知を届けてもらい、小さい画像だけ残した画像（gone）は R2 のほかのファイルを消す */
function afterSent(rows: { tbl: Tbl; data: Row }[]) {
  pushMine(rows);
  const shrunk = rows.flatMap(({ tbl, data }) => (tbl === "media" && data.gone ? [String(data.id)] : []));
  if (shrunk.length) void removeShrunkFiles(shrunk);
}

// ---- 小さい画像だけ残した画像（gone）の片付け ----

let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
function cleanupSoon() {
  if (cleanupTimer) clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(() => void cleanupGoneMedia(), 3000);
}

/**
 * 小さい画像だけ残した画像で、どこからも使われなくなったものを消す。
 * 使われているかは Supabase がすべての行で確かめる（自分に見えない行で使われている画像は消さない）。
 * 消せるのは自分が編集できるボックスの画像だけなので、ほかの画像は、編集できる人が開いたときに片付く
 */
async function cleanupGoneMedia() {
  cleanupTimer = null;
  if (!me) return;
  const { data, error } = await sb().rpc("cleanup_gone_media");
  if (error) return console.warn("使われなくなった画像を片付けられませんでした", error.message);
  const ids = (data ?? []) as string[];
  if (!ids.length) return;
  await db.transaction("rw", db.media, db.mediaBlobs, async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    await db.media.bulkDelete(ids);
    await db.mediaBlobs.bulkDelete(ids);
  });
  forgetBlobUrls(ids);
  await removeDeletedFiles(ids);
}

/** 自分の発言が Supabase に届いたら、アプリを閉じている人にも通知を届けてもらう */
function pushMine(rows: { tbl: Tbl; data: Row }[]) {
  for (const { tbl, data } of rows) {
    if (tbl !== "messages" || data.authorId !== me) continue;
    const m = data as unknown as Message;
    void pushMessage(m, () => noticeOf(m));
  }
}

function retryLater(tbl: Tbl, id: string, row: Row) {
  offline.add(`${tbl}:${id}`);
  outbox.set(`${tbl}:${id}`, { tbl, id, row });
  if (!flushTimer) flushTimer = setTimeout(() => void flush(), 10_000);
}

/**
 * ほかの人の名前の行か（ほかの人が入れた画像・ほかの人の発言・ほかの人の既読）。
 * upsert は「作る」ときの決まり（自分の名前の行しか作れない）も必ず見るので、もうある行を直すだけでも断られてしまう。こういう行は updateRow で送る
 */
function othersRow(row: Omit<ServerRow, "updated_at">) {
  const owner =
    row.tbl === "media" ? row.data.uploadedBy : row.tbl === "messages" ? row.data.authorId : row.tbl === "chatReads" || row.tbl === "reactions" ? row.data.userId : undefined;
  return owner !== undefined && owner !== me;
}

/** もうある行を直す（作らない）。直せる行が無かった（まだ無い・直せない）ときは、決まりで断られたのと同じに扱う */
async function updateRow(row: Omit<ServerRow, "updated_at">): Promise<{ code?: string; message: string } | null> {
  const { data, error } = await sb()
    .from("synced_rows")
    // 画像はボックスの間を動かせるので、ボックスも送る
    .update({ data: row.data, deleted: false, ...(row.box_id && { box_id: row.box_id }) })
    .eq("tbl", row.tbl)
    .eq("id", row.id)
    .select("tbl,id,updated_at")
    .returns<ServerRow[]>();
  remember(data);
  if (error) return error;
  return data.length ? null : { code: "42501", message: "直せる行がありません" };
}

let flushing: Promise<void> | null = null;
let flushAgain = false;

/**
 * 送る前の行を送る。送っている途中に呼ばれたら、終わってからもう一度送る（同時には送らない）。
 * 同時に送ると、遅れて届いた古い形で新しい形を上書きしたり、つながらなかった古い形を送り直して戻したりしてしまうため
 */
function flush(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      do {
        flushAgain = false;
        await flushOnce();
      } while (flushAgain && me && outbox.size);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

async function flushOnce() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (!me || !outbox.size) return;
  const items = [...outbox.entries()];
  outbox.clear();
  for (const [k] of items) sending.add(k);
  try {
    // 消した行：印を付ける（どこの行かは、もう Supabase が知っている）
    const gone = new Map<Tbl, string[]>();
    for (const [, it] of items) if (!it.row) gone.set(it.tbl, [...(gone.get(it.tbl) ?? []), it.id]);
    for (const [tbl, ids] of gone) {
      const { data, error } = await sb().from("synced_rows").update({ deleted: true }).eq("tbl", tbl).in("id", ids).select("tbl,id,updated_at").returns<ServerRow[]>();
      remember(data);
      if (error) console.warn("Supabase で消せませんでした", tbl, error.message);
      // 完全に削除した画像は、R2 のファイルも消す（消したことが Supabase に伝わってから。消せるのはボックスを編集できる人）
      else if (tbl === "media") void removeDeletedFiles(ids);
      // 発言やページなどを消したら、それで使われなくなった、小さい画像だけ残した画像を片付ける
      else cleanupSoon();
      // つながらなかったときは覚えたままにして、次に開いたときに消し直す
      if (!error || error.code) for (const id of ids) settle(`${tbl}:${id}`);
    }
    // 書いた行：どこの行かごとにまとめて送る（見られないルームの行が混ざっても、ほかの行は送れるように）
    const groups = new Map<string, Omit<ServerRow, "updated_at">[]>();
    for (const [, it] of items) {
      if (!it.row) continue;
      const scope = await scopeOf(it.tbl, it.row);
      if (!scope) {
        settle(`${it.tbl}:${it.id}`);
        continue;
      }
      const key = scope.room_id ?? scope.box_id ?? (scope.dm ?? []).join(",");
      groups.set(key, [...(groups.get(key) ?? []), { tbl: it.tbl, id: it.id, ...scope, data: it.row, deleted: false }]);
    }
    /** 1行ずつ送った結果を残す */
    const result = (row: Omit<ServerRow, "updated_at">, error: { code?: string; message: string } | null) => {
      const k = `${row.tbl}:${row.id}`;
      if (error) {
        console.warn("Supabase に送れませんでした", row.tbl, row.id, error.message);
        // つながらなかった（エラーの番号が無い）ときは、しばらくしてから送り直す。決まりで断られたものは送り直さず、画面で知らせる
        if (!error.code && !outbox.has(k)) retryLater(row.tbl, row.id, row.data);
        else if (error.code && !outbox.has(k)) setFailed(k, true);
      } else {
        offline.delete(k);
        afterSent([row]);
      }
      settle(k);
    };
    for (const all of groups.values()) {
      // ほかの人の行（ほかの人が入れた画像など）は、直すだけで送る
      for (const row of all.filter(othersRow)) result(row, await updateRow(row));
      const rows = all.filter((r) => !othersRow(r));
      for (let i = 0; i < rows.length; i += 200) {
        const batch = rows.slice(i, i + 200);
        const { data, error } = await sb().from("synced_rows").upsert(batch, { onConflict: "tbl,id" }).select("tbl,id,updated_at").returns<ServerRow[]>();
        remember(data);
        if (!error) {
          for (const row of batch) {
            offline.delete(`${row.tbl}:${row.id}`);
            settle(`${row.tbl}:${row.id}`);
          }
          afterSent(batch);
          continue;
        }
        // まとめて送れなかったら1行ずつ送り直す（送れない1行のせいで、ほかの行まで止めないため）
        for (const row of batch) {
          const one = await sb().from("synced_rows").upsert(row, { onConflict: "tbl,id" }).select("tbl,id,updated_at").returns<ServerRow[]>();
          remember(one.data);
          // 決まりで断られた（42501）：もうある行なら、直すだけなら通ることがある
          result(row, one.error?.code === "42501" ? await updateRow(row) : one.error);
        }
      }
    }
  } finally {
    for (const [k] of items) sending.delete(k);
  }
}

let hooked = false;

/** ブラウザの中の書き込みを拾うフック（Supabase 版のときだけ、1回だけ付ける） */
function hookTables() {
  if (hooked) return;
  hooked = true;
  // 閉じる前に、まだ送っていない行を送る
  window.addEventListener("pagehide", () => void flush());
  for (const tbl of TABLES) {
    const table = tableOf(tbl);
    table.hook("creating", function (_key, obj, trans) {
      if (!me || isRemote(trans)) return;
      const row = Dexie.deepClone(obj);
      trans.on("complete", () => enqueue(tbl, idOf(tbl, row), row));
    });
    table.hook("updating", function (mods, _key, obj, trans) {
      if (!me || isRemote(trans)) return;
      const row = Dexie.deepClone(obj);
      for (const [path, value] of Object.entries(mods)) Dexie.setByKeyPath(row, path, value);
      trans.on("complete", () => enqueue(tbl, idOf(tbl, row), row));
    });
    table.hook("deleting", function (_key, obj, trans) {
      // obj が無い：ブラウザの中に無い行を消そうとした（何も消えていない）
      if (!me || !obj || isRemote(trans)) return;
      const id = idOf(tbl, obj);
      trans.on("complete", () => enqueue(tbl, id, null));
    });
  }
}

// ---- 届いた行を書く ----

/**
 * 届いた行の中身が、その行の置き場所（ルームか DM）と合っているか。
 * Supabase は「置き場所のメンバーか」しか見ないので、ルーム A に、ルーム B の ID を中身に書いた行を置かれると、
 * 両方にいる人のブラウザで、ルーム B のチャットや発言を書き換えられてしまう。合わない行は書かない
 */
async function belongs(r: ServerRow): Promise<boolean> {
  const d = r.data;
  if (!d || idOf(r.tbl, d) !== r.id) return false;
  if (r.box_id) return (r.tbl === "media" || r.tbl === "libraries") && d.boxId === r.box_id;
  if (r.tbl === "media" || r.tbl === "libraries") return false;
  const roomOf = async (chatId: unknown) => (typeof chatId === "string" ? (await db.chats.get(chatId))?.roomId : undefined);
  if (r.room_id) {
    if (r.tbl === "dbViews") {
      // ビューはデータベースの ID しか持たないので、データベースのルームで確かめる（まだ届いていなければ通す）
      const database = typeof d.dbId === "string" ? await db.databases.get(d.dbId) : undefined;
      return database === undefined || database.roomId === r.room_id;
    }
    if (r.tbl === "chatReads" || r.tbl === "messages" || r.tbl === "reactions") {
      // まだ届いていないチャットの発言は通す（チャットが届けば、そのルームのものとして出る）
      const room = await roomOf(d.chatId);
      if (room !== undefined && room !== r.room_id) return false;
    }
    if (r.tbl === "dbPages" && typeof d.dbId === "string") {
      const database = await db.databases.get(d.dbId);
      if (database && database.roomId !== r.room_id) return false;
    }
    return r.tbl === "chatReads" || d.roomId === r.room_id;
  }
  if (!r.dm || r.dm.length !== 2) return false;
  const dmId = dmChatId(r.dm[0], r.dm[1]);
  switch (r.tbl) {
    case "chats":
      return d.id === dmId && !d.roomId && Array.isArray(d.dm) && [...(d.dm as string[])].sort().join() === [...r.dm].sort().join();
    case "messages":
    case "reactions":
      return d.chatId === dmId && !d.roomId;
    case "chatReads":
      return d.chatId === dmId;
    default:
      return false;
  }
}

async function applyRows(rows: ServerRow[]) {
  const usable: ServerRow[] = [];
  for (const r of rows) {
    const k = `${r.tbl}:${r.id}`;
    if (!(TABLES as readonly string[]).includes(r.tbl) || outbox.has(k) || sending.has(k)) continue;
    // 知っている形より古い（遅れて届いた知らせ）。updated_at の無い行（引いた画像の情報など）は書く
    const at = microsOf(r.updated_at);
    if (at !== null && at < (known.get(k) ?? -1)) continue;
    // 送りそこねた行で、前に開いたときにもう読んでいた形（少し前から読み直した分）は書かない。ブラウザで書いたあとの形のほうが新しい
    if (k in unsent && at !== null && at <= (readBefore[scopeKey(r)] ?? -1)) continue;
    if (await belongs(r)) usable.push(r);
    else console.warn("置き場所と合わない行を書きませんでした", r.tbl, r.id);
  }
  if (!usable.length) return;
  await db.transaction("rw", TABLES.map(tableOf), async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    for (const r of usable) {
      const table = tableOf(r.tbl);
      if (r.deleted) await table.delete(keyOf(r.tbl, r.id));
      else await table.put(r.data);
    }
  });
  remember(usable.filter((r) => r.updated_at));
}

// ---- 読み直し ----

let me: string | null = null;
/** どこまで読んだか（ルームの ID か "dm" → いちばん新しい行の時刻） */
let cursors: Record<string, string> = {};
/** 開いたときの、どこまで読んだか（マイクロ秒の数） */
let readBefore: Record<string, number> = {};
// v2：読み直しが同じ時刻の行の500件で止まっていた（2026-10-21 に直した）。
// v3：Realtime で届いた行の時刻まで読んだことにしていたので、届かなかった行（まとめて整理した画像など）を読み直さなかった（2026-10-22 に直した）。
// それまでの印では取りこぼした行があるので、一度だけ最初から読み直す
const cursorKey = () => `accord:rows:v3:${me}`;

function loadCursors() {
  try {
    localStorage.removeItem(`accord:rows:${me}`);
    localStorage.removeItem(`accord:rows:v2:${me}`);
    localStorage.removeItem("accord:rows:null");
    cursors = JSON.parse(localStorage.getItem(cursorKey()) ?? "{}") ?? {};
  } catch {
    cursors = {};
  }
}
function saveCursors() {
  // ログアウトしたあとに届いた行で、誰のものでもない覚え（accord:rows:null）を作らない
  if (!me) return;
  try {
    localStorage.setItem(cursorKey(), JSON.stringify(cursors));
  } catch {
    // 保存できなくても、次に開いたときに読み直すだけ
  }
}
function advance(scope: string, at: string) {
  if (!cursors[scope] || cursors[scope] < at) cursors[scope] = at;
}

/** 少し前から読み直す（同じころに書かれて、あとから届いた行を落とさないため。同じ行を読んでも害はない） */
const since = (at: string | undefined) => (at ? new Date(new Date(at).getTime() - 5000).toISOString() : "1970-01-01T00:00:00Z");

/** 少し前から読み直す行が、これより多ければ読み直さない（まとめて送った画像などを、読み直すたびに全部読まないように） */
const OVERLAP_MAX = 200;

/**
 * どの時刻より後を読むか。ふだんは少し前（since）から読み直すが、その間の行が多いときは、前に読んだ所の続きから読む
 * （まとめて書かれた行の中に、あとから届いた行が混ざることはまず無いため）
 */
async function startOf(scope: string) {
  const at = cursors[scope];
  if (!at) return since(at);
  let q = sb().from("synced_rows").select("id", { count: "exact", head: true }).gt("updated_at", since(at)).lte("updated_at", at);
  q = scope === "dm" ? q.not("dm", "is", null) : scope.startsWith("box:") ? q.eq("box_id", scope.slice(4)) : q.eq("room_id", scope);
  const { count, error } = await q;
  return !error && (count ?? 0) > OVERLAP_MAX ? at : since(at);
}

async function pullScope(scope: string) {
  // 2回目からは、前の回の最後の行の続きから読む。同じ時刻の行が500件より多いと（送り足しでまとめて送った画像など）、
  // 時刻だけでは続きが分からず、同じ500件を読み直して止まってしまうため、時刻・ID・表の順で続きを決める
  let after: ServerRow | null = null;
  for (;;) {
    let q = sb().from("synced_rows").select("tbl,id,room_id,dm,box_id,data,deleted,updated_at");
    q = scope === "dm" ? q.not("dm", "is", null) : scope.startsWith("box:") ? q.eq("box_id", scope.slice(4)) : q.eq("room_id", scope);
    if (after) {
      const at = JSON.stringify(after.updated_at);
      const id = JSON.stringify(after.id);
      q = q.or(`updated_at.gt.${at},and(updated_at.eq.${at},id.gt.${id}),and(updated_at.eq.${at},id.eq.${id},tbl.gt.${after.tbl})`);
    } else q = q.gt("updated_at", await startOf(scope));
    const { data, error } = await q.order("updated_at").order("id").order("tbl").limit(500).returns<ServerRow[]>();
    if (error) {
      console.warn("Supabase から読めませんでした", error.message);
      return;
    }
    if (!data.length) return;
    await applyRows(data);
    after = data[data.length - 1];
    advance(scope, after.updated_at);
    saveCursors();
    if (data.length < 500) return;
  }
}

let pulling: Promise<void> | null = null;

/** 参加しているルームと DM の、前に読んだあとに変わった行を読む。onlyNew：まだ一度も読んでいないルームだけ。only：この置き場所だけ */
export function pullRows(onlyNew = false, only?: string[]): Promise<void> {
  if (!supa || !me) return Promise.resolve();
  if (pulling) return pulling.then(() => pullRows(onlyNew, only));
  pulling = (async () => {
    try {
      const rooms = (await db.rooms.toCollection().primaryKeys()) as string[];
      const boxes = ((await db.mediaBoxes.toCollection().primaryKeys()) as string[]).map((id) => `box:${id}`);
      const all = ["dm", ...rooms, ...boxes];
      const scopes = all.filter((s) => (!onlyNew || !cursors[s]) && (!only || only.includes(s)));
      // 抜けた・消えたルームとボックスは、どこまで読んだかを忘れる（また入ったら最初から読む）
      for (const s of Object.keys(cursors)) if (!all.includes(s)) delete cursors[s];
      for (const s of scopes) await pullScope(s);
      saveCursors();
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}

let channel: RealtimeChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Realtime で行が届いた置き場所を、少しあとに読み直す。
 * Realtime は、まとめて書かれた行（何百枚もの整理など）の知らせを落とすことがあるので、届いた行の時刻まで読んだことにはしない。
 * どこまで読んだかは、読み直しで順番に読んだ所までにする（落ちた行も、ここで読む）
 */
const touched = new Set<string>();
let touchTimer: ReturnType<typeof setTimeout> | null = null;
function pullSoon(scope: string) {
  touched.add(scope);
  if (touchTimer) clearTimeout(touchTimer);
  touchTimer = setTimeout(() => {
    touchTimer = null;
    const only = [...touched];
    touched.clear();
    void pullRows(false, only);
  }, 2000);
}

const onVisible = () => {
  if (document.visibilityState === "visible") void pullRows();
};

/** 同じ名前のつながりが残っていたら外してから作る（同じ名前だと、前のつながりが返ってきて知らせを足せないため） */
export function freshChannel(name: string) {
  for (const ch of sb().getChannels()) if (ch.topic === `realtime:${name}`) void sb().removeChannel(ch);
  return sb().channel(name);
}

/** ログインした人が替わったら、写す相手と知らせの受け取りを替える（ログアウトなら止める） */
export async function startRowSync(userId: string | null) {
  if (!supa || userId === me) return;
  if (me) await flush();
  // 前の人の、つながらずに送れていない行は、ほかの人として送らない（その人の覚え（unsent）に残るので、その人がまた開いたときに送る）
  outbox.clear();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  me = userId;
  // 送りそこねた・断られた行の覚えも、その人のものに替える
  offline.clear();
  known.clear();
  if (userId) {
    loadUnsent();
    loadFailed();
  } else {
    unsent = {};
    failed = new Set();
  }
  notifySend();
  if (channel) void sb().removeChannel(channel);
  channel = null;
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
  if (!userId) return;
  hookTables();
  await forgetLocalOnlyDms(userId);
  loadCursors();
  readBefore = Object.fromEntries(Object.entries(cursors).map(([scope, at]) => [scope, microsOf(at) ?? -1]));
  await pullRows();
  // 送りそこねた行と、前に断られた行（ほかの人が入れた画像を直すと、いつも断られていた：2026-10-22 に直した）を送り直す。
  // 読み直したあとに送る。先に送ると、閉じている間にほかの所で変わった行（ゴミ箱に入れた画像など）を、
  // ブラウザの中の古い形で上書きして戻してしまう（2026-10-22 に直した）
  await resendUnsent();
  await resendRows(
    [...failed].map((k) => {
      const at = k.indexOf(":");
      return { tbl: k.slice(0, at) as Tbl, id: k.slice(at + 1) };
    }).filter((r) => (TABLES as readonly string[]).includes(r.tbl)),
  );
  // Supabase から届いた分にも、決まった ID でない DM があれば片づける
  await forgetLocalOnlyDms(userId);
  await backfillHostedRooms(userId);
  await sendMissingMedia(userId);
  // 閉じている間に、ほかの人のボックスへ移った画像（共有をやめた・ルームを消した）を片づける
  await forgetMovedMedia();
  void cleanupGoneMedia();
  channel = freshChannel(`rows:${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "synced_rows" }, (payload) => {
      const row = payload.new as ServerRow | undefined;
      if (!row?.tbl) return;
      void applyRows([row]).then(() => pullSoon(scopeKey(row)));
    })
    .subscribe((status) => {
      // つながり直したら、切れていた間の分を読む
      if (status === "SUBSCRIBED") void pullRows();
    });
  // 知らせが届かなかったときのために、しばらくおきにも読む
  timer = setInterval(() => void pullRows(), 5 * 60_000);
  document.addEventListener("visibilitychange", onVisible);
}

/** 送り足しの版。送る表を増やしたら上げる（2-3 でデータベース・ノート・ウィンドウなど、2-4 で画像の情報とライブラリーを足した） */
const BACKFILL_VERSION = 4;

/**
 * 自分がホストのルームの中身のうち、まだ Supabase に無い行を送る（このブラウザで1回だけ）。
 * 送る仕組みを作る前や、その表を送るようになる前にこのブラウザで作った行（テンプレートのデータベースなど）を、メンバーにも届けるため。
 * すでに Supabase にある行は上書きしない（メンバーが直したものを、古い形で戻さないように）
 */
async function backfillHostedRooms(userId: string) {
  const hosted = await db.rooms.filter((r) => r.createdBy === userId).toArray();
  for (const room of hosted) {
    const flag = `accord:backfill:${userId}:${room.id}`;
    try {
      if (Number(localStorage.getItem(flag)) >= BACKFILL_VERSION) continue;
    } catch {
      // 読めなければ送る（送り足しは、何度送っても害はない）
    }
    const rows: Omit<ServerRow, "updated_at">[] = [];
    const add = (tbl: Tbl, list: Row[]) => {
      for (const r of list) rows.push({ tbl, id: idOf(tbl, r), room_id: room.id, dm: null, box_id: null, data: r, deleted: false });
    };
    const inRoom = (tbl: Tbl) => tableOf(tbl).where("roomId").equals(room.id).toArray();
    for (const tbl of ["categories", "chats", "imageUsers", "databases", "dbPages", "events", "todos", "notes", "windows"] as const) add(tbl, await inRoom(tbl));
    const dbIds = (await db.databases.where("roomId").equals(room.id).primaryKeys()) as string[];
    add("dbViews", (await db.dbViews.where("dbId").anyOf(dbIds).toArray()) as unknown as Row[]);
    // 発言と既読は、自分のものだけ（ほかの人の名前では書けない）
    add("messages", ((await inRoom("messages")) as Row[]).filter((m) => m.authorId === userId));
    const chatIds = new Set(((await inRoom("chats")) as Row[]).map((c) => c.id));
    add("chatReads", ((await db.chatReads.where("userId").equals(userId).toArray()) as unknown as Row[]).filter((r) => chatIds.has(r.chatId)));
    if (!(await sendMissing(rows, room.name))) continue;
    try {
      localStorage.setItem(flag, String(BACKFILL_VERSION));
    } catch {
      // 覚えられなくても、次にまた送るだけ
    }
  }
  // 自分のボックス（マイメディアも）の、自分が入れた画像の情報とライブラリー（2-4）
  for (const box of await db.mediaBoxes.where("ownerId").equals(userId).toArray()) {
    const flag = `accord:backfill:${userId}:box:${box.id}`;
    try {
      if (Number(localStorage.getItem(flag)) >= BACKFILL_VERSION) continue;
    } catch {
      // 読めなければ送る
    }
    const rows: Omit<ServerRow, "updated_at">[] = [];
    for (const m of await db.media.where("boxId").equals(box.id).toArray()) if (m.uploadedBy === userId) rows.push({ tbl: "media", id: m.id, room_id: null, dm: null, box_id: box.id, data: m as unknown as Row, deleted: false });
    for (const l of await db.libraries.where("boxId").equals(box.id).toArray()) rows.push({ tbl: "libraries", id: l.id, room_id: null, dm: null, box_id: box.id, data: l as unknown as Row, deleted: false });
    if (!(await sendMissing(rows, box.name))) continue;
    try {
      localStorage.setItem(flag, String(BACKFILL_VERSION));
    } catch {
      // 覚えられなくても、次にまた送るだけ
    }
  }
}

/**
 * まだ Supabase に無い行だけを送る。つながらなかったときは false（次にまた送る）。
 * onRejected：決まりで断られた行（大きすぎる・編集できないボックスなど）
 */
async function sendMissing(rows: Omit<ServerRow, "updated_at">[], label: string, onRejected?: (message: string) => void) {
  let ok = true;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await sb().from("synced_rows").upsert(batch, { onConflict: "tbl,id", ignoreDuplicates: true });
    if (!error) continue;
    // まとめて送れなければ1行ずつ。決まりで断られた行（大きすぎるなど）は飛ばし、つながらなかったときだけ、次にまた送る
    for (const row of batch) {
      const one = await sb().from("synced_rows").upsert(row, { onConflict: "tbl,id", ignoreDuplicates: true });
      if (!one.error) continue;
      console.warn("まだ送っていない行を送れませんでした", label, row.tbl, row.id, one.error.message);
      if (!one.error.code) ok = false;
      else onRejected?.(one.error.message);
    }
  }
  return ok;
}

/**
 * ブラウザの中にあって Supabase に無い、画像の情報とライブラリーを送る（開くたびに確かめる）。
 * 送る仕組みを作る前に入れた画像や、閉じたせいで送りそこねた画像の情報を、あとから届けるため（送り足しはボックスごとに1回だけなので、それで漏れた分も）。
 * 画像の情報が届けば、ファイルも R2 に置ける（このあと startMediaSync が、まだ置いていない画像を置く）。
 * 送るのは、編集できるボックスの、自分が入れた画像とライブラリーだけ（ほかは決まりで断られる）
 */
async function sendMissingMedia(userId: string) {
  const rooms = new Set((await db.roomMembers.where("userId").equals(userId).toArray()).map((m) => m.roomId));
  const shares = await db.boxShares.toArray();
  const editable = (await db.mediaBoxes.toArray()).filter(
    (b) => b.ownerId === userId || shares.some((s) => s.boxId === b.id && s.canEdit && (s.userId === userId || (!!s.roomId && rooms.has(s.roomId)))),
  );
  const rejected = new Map<string, number>();
  for (const box of editable) {
    const local: Omit<ServerRow, "updated_at">[] = [];
    for (const m of await db.media.where("boxId").equals(box.id).toArray()) if (m.uploadedBy === userId) local.push({ tbl: "media", id: m.id, room_id: null, dm: null, box_id: box.id, data: m as unknown as Row, deleted: false });
    for (const l of await db.libraries.where("boxId").equals(box.id).toArray()) local.push({ tbl: "libraries", id: l.id, room_id: null, dm: null, box_id: box.id, data: l as unknown as Row, deleted: false });
    if (!local.length) continue;
    // Supabase にあるもの（消した印の付いた行も。消した画像を戻さないように）
    const onServer = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb().from("synced_rows").select("tbl,id").eq("box_id", box.id).in("tbl", ["media", "libraries"]).range(from, from + 999).returns<{ tbl: Tbl; id: string }[]>();
      // 読めなければ、このボックスは次に開いたときに確かめる
      if (error) {
        onServer.clear();
        local.length = 0;
        break;
      }
      for (const r of data) onServer.add(`${r.tbl}:${r.id}`);
      if (data.length < 1000) break;
    }
    // ほかのボックスに動いた画像は、ここでは無いことになるが、送っても上書きしない（ignoreDuplicates）
    const missing = local.filter((r) => !onServer.has(`${r.tbl}:${r.id}`));
    if (!missing.length) continue;
    await sendMissing(missing, box.name, (message) => rejected.set(message, (rejected.get(message) ?? 0) + 1));
  }
  // 編集できない・無いボックスに入っている自分の画像は送れない（どのボックスかを、あとで調べられるように残す）
  const ids = new Set(editable.map((b) => b.id));
  const stray = await db.media.filter((m) => m.uploadedBy === userId && !ids.has(m.boxId)).toArray();
  if (stray.length) console.warn("編集できない・無いボックスに入っているので送れない画像", stray.length, [...new Set(stray.map((m) => m.boxId))]);
  if (rejected.size) {
    const n = [...rejected.values()].reduce((a, b) => a + b, 0);
    toast(`画像の情報を ${n} 件送れませんでした（${[...rejected.keys()].join("／")}）`);
  }
}

/**
 * 使えなくなったボックス（消された・共有をやめられた）の画像の情報とライブラリーを、ブラウザの中から片づける。
 * Supabase では、入れた人のマイメディアに移っているか、消えている（ほかの人には知らせが届かないため、ここで消す）
 */
export async function forgetBoxes(boxIds: string[]) {
  if (!boxIds.length) return;
  await db.transaction("rw", [db.media, db.libraries], async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    await db.media.where("boxId").anyOf(boxIds).delete();
    await db.libraries.where("boxId").anyOf(boxIds).delete();
  });
  for (const id of boxIds) delete cursors[`box:${id}`];
  saveCursors();
}

/**
 * ボックスから、ほかの人のマイメディアへ移った画像（共有をやめた・ルームを消した：0014・0022）の情報を、ブラウザの中から片づける。
 * 移った先のボックスは見られないので、移ったという知らせは届かず、片づけないと元のボックスに出たままになる。
 * Supabase のそのボックスに無くなった、ほかの人が入れた画像を消す（まだ送っていない・断られた行は残す）。boxIds が無ければ、使えるボックス全部
 */
export async function forgetMovedMedia(boxIds?: string[]) {
  if (!supa || !me) return;
  const user = me;
  const boxes = boxIds ?? ((await db.mediaBoxes.toCollection().primaryKeys()) as string[]);
  const gone: string[] = [];
  for (const boxId of new Set(boxes)) {
    const local = (await db.media.where("boxId").equals(boxId).filter((m) => m.uploadedBy !== user).primaryKeys()) as string[];
    if (!local.length) continue;
    // Supabase にあるもの（消した印の付いた行も。消した行は読み直しで消える）
    const onServer = new Set<string>();
    let ok = true;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb().from("synced_rows").select("id").eq("tbl", "media").eq("box_id", boxId).range(from, from + 999).returns<{ id: string }[]>();
      // 読めなければ、このボックスは次に開いたときに確かめる
      if (error) {
        ok = false;
        break;
      }
      for (const r of data) onServer.add(r.id);
      if (data.length < 1000) break;
    }
    if (!ok) continue;
    for (const id of local) {
      const k = `media:${id}`;
      if (!onServer.has(id) && !outbox.has(k) && !sending.has(k) && !(k in unsent) && !failed.has(k)) gone.push(id);
    }
  }
  if (me !== user || !gone.length) return;
  await db.transaction("rw", db.media, async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    await db.media.bulkDelete(gone);
  });
}

/**
 * 2人で決まる ID（dmChatId）でない DM を片づける。Supabase につなぐ前にこのブラウザの中だけで作った DM は相手に届いておらず、
 * 2人の DM が二重に出てしまうため（データは移さずに新しく始める：2026-10-20）。
 * 「dm:」で始まるものは、作りかけの形で Supabase にも送ってしまったので、Supabase でも消す
 */
async function forgetLocalOnlyDms(userId: string) {
  const old = await db.chats.where("dm").equals(userId).filter((c) => !!c.dm && c.id !== dmChatId(c.dm[0], c.dm[1])).primaryKeys();
  if (!old.length) return;
  const sent = old.filter((id) => id.startsWith("dm:"));
  await db.transaction("rw", TABLES.map(tableOf), async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    const local = old.filter((id) => !sent.includes(id));
    await db.messages.filter((m) => local.includes(m.chatId)).delete();
    await db.chatReads.filter((r) => local.includes(r.chatId)).delete();
    await db.chats.bulkDelete(local);
  });
  if (sent.length) await db.chats.bulkDelete(sent);
}

/** 引いたことのある画像の ID（同じ画像を何度も引かないように） */
const askedMedia = new Set<string>();

/**
 * ボックスでは見られないが、見られる発言やノートに貼られている画像の情報を引く（DM で送られた画像など：0017）。
 * 引いた画像の情報はブラウザの中に書く（そのボックスの変更は届かないので、引いたときの形のまま）
 */
export async function fetchReferencedMedia(ids: string[]) {
  if (!supa || !me) return;
  const fresh = ids.filter((id) => !askedMedia.has(id));
  if (!fresh.length) return;
  for (const id of fresh) askedMedia.add(id);
  for (let i = 0; i < fresh.length; i += 100) {
    const { data, error } = await sb().rpc("media_for_ids_checked", { ids: fresh.slice(i, i + 100) });
    if (error) {
      // 引けなかったものは、次にまた引けるようにする
      for (const id of fresh.slice(i, i + 100)) askedMedia.delete(id);
      continue;
    }
    await applyRows((data ?? []) as ServerRow[]);
  }
}
