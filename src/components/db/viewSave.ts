"use client";

import { createContext, useContext } from "react";
import type { DbView } from "@/lib/local/db";
import { saveView } from "@/lib/local/requests";

/**
 * ビューを保存する先。ふつうはデータベースのビュー（saveView）。
 * オールビューのブロックが自分だけのビューを持つときは、ブロックの中に保存するものに差し替える。
 * ビューの設定・表の列の幅・列のメニューなど、ビューを直すところはこれを使う
 */
export const ViewSaveContext = createContext<(view: DbView) => Promise<void> | void>(saveView);

export const useSaveView = () => useContext(ViewSaveContext);
