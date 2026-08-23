"use client";

import { useState } from "react";
import { CountrySection } from "@/components/country-section";
import { RegionSection } from "@/components/region-section";

/**
 * 地域と国。
 *
 * 国を登録するとき、どの地域に入れるかを見ながら選べるよう、横に並べる。
 * 幅が足りないと5列が読めなくなるので、1280px 未満では縦に積む。
 * 地域は10件ほどで頭打ちだが国は増えていくため、右のほうが長くなる。
 */
export default function RegionsPage() {
  // 地域を足したり消したりしたら、国の「地域」の選択肢を引き直す
  const [regionsVersion, setRegionsVersion] = useState(0);

  return (
    <div className="grid w-full grid-cols-1 items-start gap-8 p-4 xl:grid-cols-2 lg:p-6">
      <RegionSection onChanged={() => setRegionsVersion((v) => v + 1)} />
      <CountrySection regionsVersion={regionsVersion} />
    </div>
  );
}
