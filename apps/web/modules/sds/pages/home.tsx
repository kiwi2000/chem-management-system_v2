import Link from "next/link";
import type { ModulePageProps } from "../../types";
import { sdsMessages } from "../messages";

/** SDS 作成の入口。いまは準備中の案内と、標準の GHS分類データへの入口だけ */
export function SdsHomePage({ locale }: ModulePageProps) {
  const t = sdsMessages(locale);
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="text-muted-foreground">{t.preparing}</p>
      <ul className="list-disc pl-5">
        <li>
          <Link href="/ghs-data" className="text-primary underline-offset-2 hover:underline">
            {t.linkGhsData}
          </Link>
        </li>
      </ul>
    </div>
  );
}
