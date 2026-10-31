"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { JUMP_EVENT } from "./useMessageWindow";

/** 人がスクロールや操作をしたと分かる出来事 */
const ACTIONS = ["wheel", "touchstart", "pointerdown", "keydown"];

/**
 * 発言一覧のスクロールの位置を決める。
 * 開いたとき：読んでいない発言があれば「ここから未読」の線を上の方に出す。無ければ一番下から。
 * 画像・リアクション・引用は発言より遅れて出て高さが変わるので、人が動かすまでは、決めた位置を保つ。
 * タブの裏・隠れた列・ブラウザのタブが裏にあるときは位置を決めず、見えるようになったときに、未読を調べ直して開き直す（上の方を読んでいたときはそのまま）。
 * そのあとは、一番下を見ているときだけ、新しい発言が来ても一番下に付いていく。
 * located は useMessageWindow の、未読を調べ終えた回数。relocate は調べ直す関数
 */
export function useChatPosition(
  list: RefObject<HTMLElement | null>,
  ready: boolean,
  last: { id: string; authorId: string } | undefined,
  meId: string,
  located: number,
  relocate: () => void,
) {
  // 発言一覧の中身（高さが変わったことを知るために付ける）
  const content = useRef<HTMLDivElement>(null);
  // 一番下から遠くまで戻ったか（「最新の発言へ」を出す）
  const [far, setFar] = useState(false);
  const stick = useRef(true);
  const placed = useRef(false);
  // 人が動かすまで保つ位置
  const hold = useRef<"line" | "bottom" | null>(null);
  const hidden = useRef(false);
  const height = useRef(0);
  // 位置を決める前に、人が触ったか（そのときは、位置を決めても保たない）
  const touchedEarly = useRef(false);
  // 前に見たスクロールの位置（人が動かしたことを知るため）
  const top = useRef(0);

  const toBottom = (el: HTMLElement) => {
    el.scrollTop = el.scrollHeight;
    top.current = el.scrollTop;
    stick.current = true;
    hold.current = "bottom";
  };

  const place = (el: HTMLElement) => {
    placed.current = true;
    const line = el.querySelector<HTMLElement>("[data-unread-line]");
    if (line) {
      el.scrollTop += line.getBoundingClientRect().top - el.getBoundingClientRect().top - 40;
      top.current = el.scrollTop;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      hold.current = "line";
    } else toBottom(el);
    // 位置を決めたときの高さを覚える（このあとの見張りが「高さが変わった」と思って、一番下に戻さないように）
    height.current = el.clientHeight;
    if (touchedEarly.current) hold.current = null;
    touchedEarly.current = false;
  };

  /** 保っている位置から、人が動かしたか。高さが変わっただけでは上へは動かない（縮んだときは一番下のまま）ので、区別できる */
  const movedAway = (el: HTMLElement, gap: number) => {
    if (hold.current === "bottom") return el.scrollTop < top.current - 1 && gap > 8;
    if (hold.current !== "line") return false;
    const line = el.querySelector<HTMLElement>("[data-unread-line]");
    return !line || Math.abs(line.getBoundingClientRect().top - el.getBoundingClientRect().top - 40) > 24;
  };

  /** 見えているか確かめる。隠れていたものが見えるようになったときは、開き直す（false を返す） */
  const visible = (el: HTMLElement) => {
    if (document.visibilityState !== "visible" || !el.clientHeight) {
      hidden.current = true;
      return false;
    }
    if (!hidden.current) return true;
    hidden.current = false;
    if (stick.current) {
      placed.current = false;
      relocate();
    }
    return false;
  };

  useLayoutEffect(() => {
    const el = list.current;
    if (!el || !ready || !visible(el)) return;
    if (!placed.current) return place(el);
    if (stick.current || last?.authorId === meId) toBottom(el);
    // 見えるようになったときの開き直しは、未読を調べ終えて（located が変わって）から
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, last?.id, last?.authorId, meId, located]);

  useEffect(() => {
    const el = list.current;
    const inner = content.current;
    // 発言を読み込んでいる間から受け取る（読み込み中に指を置いたときも、人が動かしたと分かるように）
    if (!el || !inner) return;
    const check = () => {
      if (!visible(el) || !placed.current) return;
      if (hold.current === "line") place(el);
      // 入力欄が大きくなった・スマホのキーボードが出たなどで一覧が縮んでも、一番下を見ていれば一番下のまま
      else if (hold.current === "bottom" || (stick.current && el.clientHeight !== height.current)) toBottom(el);
      height.current = el.clientHeight;
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    ro.observe(inner);
    document.addEventListener("visibilitychange", check);
    // 人が動かしたら、保つのをやめる（一覧の上に重なるボタンを押したとき・検索やピンから飛んだときも）
    const release = () => {
      hold.current = null;
      if (!placed.current) touchedEarly.current = true;
    };
    const area = el.parentElement ?? el;
    for (const type of ACTIONS) area.addEventListener(type, release, { passive: true });
    window.addEventListener(JUMP_EVENT, release);
    return () => {
      ro.disconnect();
      document.removeEventListener("visibilitychange", check);
      for (const type of ACTIONS) area.removeEventListener(type, release);
      window.removeEventListener(JUMP_EVENT, release);
    };
    // place・visible は list と relocate から作る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /** 発言一覧の onScroll に付ける */
  const onScroll = (el: HTMLElement) => {
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 指を置いた知らせが届かなかったときも、動かしたら保つのをやめる
    if (movedAway(el, gap)) hold.current = null;
    top.current = el.scrollTop;
    stick.current = gap < 80;
    const isFar = gap > el.clientHeight * 1.5;
    if (isFar !== far) setFar(isFar);
  };

  return { content, far, onScroll };
}
