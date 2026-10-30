"use client";

import { useEffect, useRef } from "react";

// 中で操作するブロック（チャット・データベース）を、押してもブロックごと選ばれないようにする（Notion と同じ）

/**
 * ブロックの meta。selectable: false にすると、押したところをエディタに渡さず、ブラウザに任せる。
 * 押してもブロックごと選ばれて青くならず、中の文字をドラッグで選んでコピーできる
 * （選べるブロックのままだと、押すとブロックごと選ばれて、ドラッグがブロックを動かす操作になる）。
 * 消す・動かすのは「⋮⋮」から
 */
export const INSIDE_META = { selectable: false } as const;

type NodeViewSpec = { ignoreMutation: (m: { type: string; target: Node }) => boolean };

/**
 * ブロックの中で選んだ文字を、エディタが自分の選択で上書きしないようにする。
 * TipTap は中身の無いブロックの中の選択もエディタに読ませるので、読んだエディタが近くのブロックを選び直してしまう
 */
export function SelectInside({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    const spec = (box?.closest(".react-renderer") as { pmViewDesc?: { spec?: NodeViewSpec } } | null)?.pmViewDesc?.spec;
    if (!box || !spec) return;
    const original = spec.ignoreMutation;
    spec.ignoreMutation = function (m) {
      return (m.type === "selection" && box.contains(m.target)) || original.call(this, m);
    };
    return () => {
      spec.ignoreMutation = original;
    };
  }, []);
  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}
