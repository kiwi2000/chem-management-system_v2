"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/lib/i18n-client";
import { useMe } from "@/lib/use-me";
import { SubstancesTable } from "./substances-table";

/**
 * 物質の一覧。
 *
 * 使えるもの（公開済）を上、まだ使えないもの（作成中・承認待・却下）を下に分ける。
 * 下の表は、未公開のデータを見られる人にだけ出す。
 */
export function SubstancesLists({ approvalRequired }: { approvalRequired: boolean }) {
  const { m } = useI18n();
  const { can } = useMe();
  const showWorking = can("INACTIVE_VIEW") || can("SUBSTANCE_EDIT") || can("APPROVE");

  // 状態を変えると下から上へ移るので、両方を読み直す
  const [reloadToken, setReloadToken] = useState(0);
  const onChanged = useCallback(() => setReloadToken((v) => v + 1), []);

  return (
    <div className="w-full space-y-8 p-4 lg:p-6">
      <SubstancesTable
        scope="published"
        approvalRequired={approvalRequired}
        reloadToken={reloadToken}
        onChanged={onChanged}
      />

      {showWorking && (
        <SubstancesTable
          scope="working"
          title={m.substances.workingSection}
          approvalRequired={approvalRequired}
          reloadToken={reloadToken}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
