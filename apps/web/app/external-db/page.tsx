"use client";

import { useCallback, useState } from "react";
import { DataSourceSection } from "@/components/data-source-section";
import { LinkVersionSection } from "@/components/link-version-section";
import { SourceSection } from "@/components/source-section";
import { useI18n } from "@/lib/i18n-client";

/**
 * 外部データベース。
 *
 * LOLIなどから取り込んだ「法文物質名 ↔ CAS番号」の対応を管理する。
 *
 *   データソース種別 … どこから来るデータか（LOLI・CHRIP・自社データ）
 *   バージョン       … いつ時点か。コードだけ
 *   データソース     … 選んだバージョンのぶん。取り込みと手入力の単位
 *
 * 上に種別、下の段は左にバージョン・右にデータソース。
 * バージョンの行を選ぶと、右がそのバージョンのものに入れ替わる
 * （地域・国と同じ「左で選んで右を見る」形）。
 */
export default function ExternalDbPage() {
  const { m } = useI18n();
  // 種別を足したら、データソースの選択肢を引き直す
  const [token, setToken] = useState(0);
  const bump = useCallback(() => setToken((v) => v + 1), []);

  const [version, setVersion] = useState<{ id: string; code: string } | null>(null);
  const onSelectVersion = useCallback((id: string, code: string) => setVersion({ id, code }), []);

  return (
    <div className="w-full space-y-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{m.externalDb.title}</h1>

      {/* 種別は2列しかないので、横いっぱいには広げない */}
      <div className="max-w-[404px]">
        <SourceSection onChanged={bump} />
      </div>

      {/* バージョンは列が2つだけなので幅を決め打ちし、残りをデータソースに渡す */}
      <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
        <div className="w-full shrink-0 xl:w-[228px]">
          <LinkVersionSection
            selectedId={version?.id ?? null}
            onSelect={onSelectVersion}
            onChanged={bump}
          />
        </div>
        {/* 列の合計ぶんだけ。画面が広くても表は広げない */}
        <div className="min-w-0 flex-1 xl:max-w-[622px]">
          <DataSourceSection
            versionId={version?.id ?? null}
            versionCode={version?.code ?? null}
            reloadToken={token}
          />
        </div>
      </div>
    </div>
  );
}
