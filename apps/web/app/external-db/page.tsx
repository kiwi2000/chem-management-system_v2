"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { CasLinkTable, type CasLinkScope } from "@/components/cas-link-table";
import { DataSourceSection } from "@/components/data-source-section";
import { LinkVersionSection } from "@/components/link-version-section";
import { SourceSection } from "@/components/source-section";
import type { LinkVersionSourceDto } from "@/lib/types";

/**
 * 外部データベース。
 *
 * LOLIなどから取り込んだ「法文物質名 ↔ CAS番号」の対応を管理する。
 *
 *   データソース種別 … どこから来るデータか（LOLI・CHRIP・自社データ）
 *   バージョン       … いつ時点か。コードだけ
 *   データソース     … 選んだバージョンのぶん。取り込みと手入力の単位
 *   対象CAS          … 選んだバージョン × データソースの中身。取り込んだ結果をまとめて確かめる
 *
 * 上に種別、下の段は左にバージョン・右にデータソース、そのさらに下に対象CASの表。
 * バージョンの行を選ぶと右がそのバージョンのものに入れ替わり、
 * データソースの行を選ぶと下の表がその組の中身になる
 * （地域・国と同じ「左で選んで右を見る」形）。
 *
 * 区分・法律の画面から来たときは URL に範囲（`scopeCategory` / `scopeLaw`）が付いていて、
 * 表がその範囲に絞られる。`version` は id か "current"、`source` はデータソースの行の id
 */
export default function ExternalDbPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 種別を足したら、データソースの選択肢を引き直す
  const [token, setToken] = useState(0);
  const bump = useCallback(() => setToken((v) => v + 1), []);

  // 入口から来たときの望み。バージョンは "current" なら左の表が現在のものを選ぶ（既定の動き）
  const wantedVersion = searchParams.get("version");
  const wantedSource = searchParams.get("source");
  const [version, setVersion] = useState<{ id: string; code: string } | null>(
    wantedVersion && wantedVersion !== "current" ? { id: wantedVersion, code: "" } : null,
  );
  const onSelectVersion = useCallback((id: string, code: string) => setVersion({ id, code }), []);

  const [source, setSource] = useState<LinkVersionSourceDto | null>(null);
  /*
    選んだバージョン × データソースは URL にも書いておく。
    版の切り替わりなどで画面が丸ごと読み直されても、同じ組が選ばれた状態に戻る
    （件数を変えた拍子に USER に戻ってしまい、選び直しになったことがあった）
  */
  const onSelectSource = useCallback(
    (row: LinkVersionSourceDto | null) => {
      setSource(row);
      if (!row) return;
      const next = new URLSearchParams(window.location.search);
      if (next.get("version") === row.versionId && next.get("source") === row.id) return;
      next.set("version", row.versionId);
      next.set("source", row.id);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const scope = useMemo<CasLinkScope>(
    () => ({
      lawId: searchParams.get("scopeLaw"),
      categoryId: searchParams.get("scopeCategory"),
      label: searchParams.get("scopeLabel"),
    }),
    [searchParams],
  );
  /** 範囲を外す。URL から範囲の項目だけ取り除く（表の絞り込みは残す） */
  const clearScope = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    for (const k of ["scopeLaw", "scopeCategory", "scopeLabel"]) next.delete(k);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname, searchParams]);

  return (
    <div className="w-full space-y-6 p-4 lg:p-6">
      {/* 種別は2列しかないので、横いっぱいには広げない */}
      <div className="max-w-[444px]">
        <SourceSection onChanged={bump} />
      </div>

      {/* バージョンは列が2つだけなので幅を決め打ちし、残りをデータソースに渡す */}
      <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
        <div className="w-full shrink-0 xl:w-[268px]">
          <LinkVersionSection
            selectedId={version?.id ?? null}
            onSelect={onSelectVersion}
            onChanged={bump}
          />
        </div>
        {/* 右の表は画面の幅いっぱいに。上限を置くと列を広げられない */}
        <div className="min-w-0 flex-1">
          <DataSourceSection
            versionId={version?.id ?? null}
            versionCode={version?.code ?? null}
            reloadToken={token}
            onSelect={onSelectSource}
            preferredId={wantedSource}
          />
        </div>
      </div>

      {/* 選んだバージョン × データソースの中身。取り込んだ結果をここでまとめて確かめる */}
      <CasLinkTable
        versionId={source?.versionId ?? null}
        versionCode={source ? version?.code || null : null}
        sourceId={source?.sourceId ?? null}
        sourceCode={source?.sourceCode ?? null}
        scope={scope}
        onClearScope={clearScope}
      />
    </div>
  );
}
