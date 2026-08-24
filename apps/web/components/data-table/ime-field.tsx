"use client";

import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/*
  日本語を打つための入力欄。

  ふつうの入力欄は、1文字打つたびにその値を親へ渡して、親から戻ってきた値を映す。
  日本語は「にほんご」と打ってから漢字に変換するので、変換の途中で親から値が戻ると
  変換が打ち切られてしまい、打ちかけの文字が消えたり二重に入ったりする。

  そこで、変換が終わるまでは打った文字を自分の中だけで持ち、
  確定したところで親へ渡す。英数字はこれまでどおり1文字ごとに渡る。
*/

/** 変換中かどうかを覚えつつ、確定した文字だけを親へ渡す */
function useImeDraft(value: string, onValueChange: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);

  useEffect(() => {
    // 条件のクリアや、保存した条件の読込など、外から変わったときだけ合わせる
    if (!composing.current) setDraft(value);
  }, [value]);

  return {
    value: draft,
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (e: { currentTarget: { value: string } }) => {
      composing.current = false;
      const next = e.currentTarget.value;
      setDraft(next);
      onValueChange(next);
    },
    onChange: (e: { target: { value: string } }) => {
      const next = e.target.value;
      setDraft(next);
      if (!composing.current) onValueChange(next);
    },
  };
}

type InputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange">;

/** 日本語を打てる1行の入力欄 */
export function ImeInput({
  value,
  onValueChange,
  ...rest
}: InputProps & { value: string; onValueChange: (next: string) => void }) {
  const ime = useImeDraft(value, onValueChange);
  return <Input {...rest} {...ime} />;
}

type TextareaProps = Omit<ComponentProps<"textarea">, "value" | "onChange">;

/** 日本語を打てる複数行の入力欄 */
export function ImeTextarea({
  value,
  onValueChange,
  className,
  ...rest
}: TextareaProps & { value: string; onValueChange: (next: string) => void }) {
  const ime = useImeDraft(value, onValueChange);
  return <textarea {...rest} className={cn(className)} {...ime} />;
}
