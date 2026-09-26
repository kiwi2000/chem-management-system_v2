import type { ModulePageProps } from "../../types";
import { sdsMessages } from "../messages";

/** SDS 作成の入口。機能ができるまでの仮の画面（メニューの位置を確かめるため） */
export function SdsHomePage({ locale }: ModulePageProps) {
  const t = sdsMessages(locale);
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="text-muted-foreground">{t.preparing}</p>
    </div>
  );
}
