"use client";

import { useState } from "react";
import { CountrySection } from "@/components/country-section";
import { RegionSection } from "@/components/region-section";

/**
 * 地域と国。
 * 親子で続けて登録することが多いので、1つの画面に上下で並べる
 * （グループ管理と同じ形）。
 */
export default function RegionsPage() {
  // 地域を足したり消したりしたら、国の「地域」の選択肢を引き直す
  const [regionsVersion, setRegionsVersion] = useState(0);

  return (
    <div className="w-full space-y-8 p-4 lg:p-6">
      <RegionSection onChanged={() => setRegionsVersion((v) => v + 1)} />
      <CountrySection regionsVersion={regionsVersion} />
    </div>
  );
}
