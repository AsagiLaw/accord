"use client";

import { renumberPlan } from "@/lib/media/autoname";
import { db, type Media } from "./db";

/**
 * ボックスの自動の名前（20250101_誕生日_01）の番号を詰めて（1枚だけになったら番号を外して）、名前を付け直す。
 * 画像が加わった・抜けた（ゴミ箱・ほかのボックスへ）・タイトルや制作日が変わったあとに呼ぶ
 */
export async function renumber(boxId: string) {
  await db.transaction("rw", db.media, async () => {
    const plan = renumberPlan(await db.media.where("boxId").equals(boxId).toArray());
    for (const p of plan) await db.media.update(p.id, { seq: p.seq, name: p.name });
  });
}

/** 画像の入っているボックスごとに、番号を詰める */
export async function renumberBoxes(rows: (Media | undefined)[]) {
  for (const boxId of new Set(rows.flatMap((m) => (m ? [m.boxId] : [])))) await renumber(boxId);
}
