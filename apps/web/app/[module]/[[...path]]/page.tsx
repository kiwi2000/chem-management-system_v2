import { notFound } from "next/navigation";
import { getLocale } from "@/lib/i18n";
import { SERVER_MODULES } from "@/modules/registry.server.generated";

/**
 * モジュール（差込口から入る機能）の画面。`/<モジュール名>/<以下の道筋>` をそのモジュールに渡す。
 *
 * 本体の画面（/products など）は名前が決まっているので優先され、ここに来るのは本体に無い道筋だけ。
 * 知らないモジュール・無い画面は 404（本体に無い道筋は、これまでどおり 404 のまま）。
 * ログインしているかは AppShell が見ているので、ここでは確かめない
 */
export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string; path?: string[] }>;
}) {
  const { module: id, path = [] } = await params;
  const Page = SERVER_MODULES.find((m) => m.id === id)?.page(path) ?? null;
  if (!Page) notFound();
  return <Page locale={await getLocale()} path={path} />;
}
