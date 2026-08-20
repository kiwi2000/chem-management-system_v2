"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/lib/i18n-client";
import { useMe } from "@/lib/use-me";
import { ProductsTable } from "./products-table";

interface Props {
  modelOptions: string[];
  useOptions: string[];
  approvalRequired: boolean;
}

/**
 * 製品 / 原材料の一覧。
 *
 * 使えるもの（公開済）を上、まだ使えないもの（作成中・承認待ち・却下）を下に分ける。
 * 作業中のものが業務の一覧に混ざらないようにするため。
 * 下の表は、未公開のデータを見られる人にだけ出す。
 */
export function ProductsLists({ modelOptions, useOptions, approvalRequired }: Props) {
  const { m } = useI18n();
  const { can } = useMe();
  const showWorking = can("INACTIVE_VIEW") || can("PRODUCT_EDIT") || can("APPROVE");

  // 状態を変えると下から上へ移るので、両方を読み直す
  const [reloadToken, setReloadToken] = useState(0);
  const onChanged = useCallback(() => setReloadToken((v) => v + 1), []);

  return (
    <div className="w-full space-y-8 p-4 lg:p-6">
      <ProductsTable
        scope="published"
        modelOptions={modelOptions}
        useOptions={useOptions}
        approvalRequired={approvalRequired}
        reloadToken={reloadToken}
        onChanged={onChanged}
      />

      {showWorking && (
        <ProductsTable
          scope="working"
          title={m.products.workingSection}
          modelOptions={modelOptions}
          useOptions={useOptions}
          approvalRequired={approvalRequired}
          reloadToken={reloadToken}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
