"use client";

import { DEFAULT_SETTINGS, pickPasswordPolicy, type PasswordPolicy } from "@chem/shared";
import { useEffect, useState } from "react";

/**
 * いま効いているパスワードの決まりを取ってくる。
 *
 * システム設定そのものは管理者しか読めないので、決まりだけを返す入口から引く。
 * 取れるまでは既定で見る。読み込み中に何も言わないでいると、
 * 決まりを満たしていない値でも大丈夫そうに見えてしまうため。
 */
export function usePasswordPolicy(): PasswordPolicy {
  const [policy, setPolicy] = useState<PasswordPolicy>(pickPasswordPolicy(DEFAULT_SETTINGS));

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/password-policy").catch(() => null);
      if (!res?.ok || !alive) return;
      const body = (await res.json()) as { policy?: PasswordPolicy };
      if (body.policy && alive) setPolicy(body.policy);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return policy;
}
