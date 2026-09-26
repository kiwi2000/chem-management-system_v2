import type { Locale, Permission } from "@chem/shared";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

/**
 * 差込口（モジュール）の宣言。
 *
 * 特定のお客さんにだけ渡す機能（SDS 作成など）は `apps/web/modules/<id>/` に置き、
 * 本体はここで決めた形だけを知る。**本体からモジュールのフォルダを直接 import しない**（lint で止める）。
 * 結び目は `registry.generated.ts` / `registry.server.generated.ts` だけで、
 * どちらも `scripts/gen-modules.mjs` が dev・build・typecheck・test の前に作る。
 * 有効にするモジュールは環境変数 `CHEM_MODULES`（例: `sds`）か、配布物に同梱する `enabled.json` で決まり、
 * どちらも無ければ空。**空のときは、モジュールのコードはビルドに一切入らない。**
 *
 * 宣言は 2 つに分ける。メニューはクライアント側（"use client"）で描くので、
 * `manifest.ts` から DB や next/headers に触るものを import してはいけない。
 * 画面そのものはサーバー側の `server.ts` から差し込む
 */

/** メニューの 1 行。文言は本体の辞書に入れず、モジュールが両言語ぶん持つ */
export interface ModuleNavItem {
  href: string;
  label: Record<Locale, string>;
  icon: LucideIcon;
  /** この権限が無い人には出さない。並びなら、どれか 1 つあればよい */
  needs?: Permission | Permission[];
  /** この接頭辞のパスでも選択中扱いにする */
  match?: string[];
}

/** クライアントでも読み込む宣言（`<id>/manifest.ts` の default export） */
export interface ModuleManifest {
  /** フォルダ名と同じ。URL は `/<id>/…` */
  id: string;
  nav: ModuleNavItem[];
}

export interface ModulePageProps {
  locale: Locale;
  /** `/<id>/` より後ろの道筋。トップなら空 */
  path: string[];
}

/** サーバーだけが読み込む宣言（`<id>/server.ts` の default export） */
export interface ModuleServer {
  id: string;
  /** その道筋の画面。無ければ null（404 になる） */
  page: (path: string[]) => ComponentType<ModulePageProps> | null;
}
