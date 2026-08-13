/**
 * 権限。
 * 「役割」ではなく権限そのものをユーザーに持たせる（画面のプリセットで一括設定できる）。
 * 追加するときは Prisma の Permission enum・i18n の permissions ブロックも合わせて増やすこと。
 */
export const PERMISSIONS = [
  // 製品 / 原材料（判定の実行・逆引き検索は「製品を見られる」に含む）
  "PRODUCT_VIEW",
  "PRODUCT_VIEW_PRIVATE",
  "PRODUCT_EDIT",
  // 組成（組成の編集は PRODUCT_EDIT に含む）
  "COMPOSITION_VIEW",
  "COMPOSITION_VIEW_PRIVATE",
  // 物質
  "SUBSTANCE_VIEW",
  "SUBSTANCE_EDIT",
  // 法規制（金属換算係数・情報源・リンクバージョンを含む）
  "REGULATION_VIEW",
  "REGULATION_EDIT",
  // 持ち出し（TSV出力・帳票ダウンロード）
  "DATA_EXPORT",
  // お知らせ
  "NEWS_POST",
  "NEWS_MANAGE",
  // システム管理（ユーザー管理・システム設定・監査ログ）
  "ADMIN",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(v: unknown): v is Permission {
  return typeof v === "string" && (PERMISSIONS as readonly string[]).includes(v);
}

/**
 * 権限の含意。
 * 「編集できるが見られない」は成立しないので、付与時に自動で補う。
 * 補った結果を保存するので、判定側は単純な集合の所属チェックで済む。
 */
const IMPLIES: Partial<Record<Permission, readonly Permission[]>> = {
  // 組成の編集は製品の編集に含まれるため、組成の閲覧も必要
  PRODUCT_EDIT: ["PRODUCT_VIEW", "COMPOSITION_VIEW"],
  PRODUCT_VIEW_PRIVATE: ["PRODUCT_VIEW"],
  COMPOSITION_VIEW_PRIVATE: ["COMPOSITION_VIEW"],
  SUBSTANCE_EDIT: ["SUBSTANCE_VIEW"],
  REGULATION_EDIT: ["REGULATION_VIEW"],
  // 他人のお知らせを編集できる人は、自分でも投稿できるものとして扱う
  NEWS_MANAGE: ["NEWS_POST"],
};

/** 含意をたどって権限集合を閉じる（保存前・チェックボックス操作時の両方で使う） */
export function expandPermissions(granted: Iterable<Permission>): Permission[] {
  const set = new Set<Permission>(granted);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of [...set]) {
      for (const implied of IMPLIES[p] ?? []) {
        if (!set.has(implied)) {
          set.add(implied);
          changed = true;
        }
      }
    }
  }
  // 定義順に並べ替えて返す（保存内容が操作順に依存しないように）
  return PERMISSIONS.filter((p) => set.has(p));
}

/**
 * その権限を前提にしている権限（間接的なものも含む）。
 * 外したときに一緒に外すべきものを求めるために使う。
 */
export function dependentsOf(target: Permission): Permission[] {
  const found = new Set<Permission>();
  const stack: Permission[] = [target];
  while (stack.length > 0) {
    const cur = stack.pop() as Permission;
    for (const p of PERMISSIONS) {
      if (!found.has(p) && (IMPLIES[p] ?? []).includes(cur)) {
        found.add(p);
        stack.push(p);
      }
    }
  }
  return PERMISSIONS.filter((p) => found.has(p));
}

/** 画面でのグループ分け（この順に並べる） */
export const PERMISSION_GROUPS: { key: string; permissions: readonly Permission[] }[] = [
  { key: "product", permissions: ["PRODUCT_VIEW", "PRODUCT_VIEW_PRIVATE", "PRODUCT_EDIT"] },
  { key: "composition", permissions: ["COMPOSITION_VIEW", "COMPOSITION_VIEW_PRIVATE"] },
  { key: "substance", permissions: ["SUBSTANCE_VIEW", "SUBSTANCE_EDIT"] },
  { key: "regulation", permissions: ["REGULATION_VIEW", "REGULATION_EDIT"] },
  { key: "data", permissions: ["DATA_EXPORT"] },
  { key: "news", permissions: ["NEWS_POST", "NEWS_MANAGE"] },
  { key: "system", permissions: ["ADMIN"] },
];

/** よく使う組み合わせ。押すとチェックが一括で入る（その後の個別調整は自由） */
export const PERMISSION_PRESETS: { key: string; permissions: readonly Permission[] }[] = [
  {
    key: "viewer",
    permissions: ["PRODUCT_VIEW", "COMPOSITION_VIEW", "SUBSTANCE_VIEW", "REGULATION_VIEW"],
  },
  {
    key: "staff",
    permissions: [
      "PRODUCT_VIEW",
      "PRODUCT_EDIT",
      "COMPOSITION_VIEW",
      "SUBSTANCE_VIEW",
      "SUBSTANCE_EDIT",
      "REGULATION_VIEW",
      "DATA_EXPORT",
      "NEWS_POST",
    ],
  },
  {
    key: "regulation",
    permissions: [
      "PRODUCT_VIEW",
      "COMPOSITION_VIEW",
      "SUBSTANCE_VIEW",
      "REGULATION_VIEW",
      "REGULATION_EDIT",
      "DATA_EXPORT",
    ],
  },
  { key: "admin", permissions: PERMISSIONS },
];

/** 何かを編集できるか（画面の「参照のみ」表示に使う） */
export function canEditAnything(granted: readonly Permission[]): boolean {
  return (
    granted.includes("PRODUCT_EDIT") ||
    granted.includes("SUBSTANCE_EDIT") ||
    granted.includes("REGULATION_EDIT")
  );
}
