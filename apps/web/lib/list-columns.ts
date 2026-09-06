import { normalizeCas, normalizeCode } from "@chem/shared";
import { anyOfTextCondition, type QueryColumn } from "@/lib/table-query";

/**
 * 製品の一覧で「法規制に当たるか」で絞る。
 *
 * 判定は区分ごとに1行ずつ持っており、**当たらなかった区分の行も残る**。
 * そのため「該当なし」は「行が無い」ではなく「該当の行が1つも無い」。
 * 「行そのものが無い」は、まだ一度も判定していないという別の意味になる。
 */
function judgementCondition(values: string[]): Record<string, unknown> | null {
  const hit = { judgements: { some: { verdict: "APPLICABLE" as const } } };
  const each: Record<string, unknown>[] = [];
  for (const v of new Set(values)) {
    if (v === "hit") each.push(hit);
    // 判定はしてあるが、どの区分にも当たらなかった
    else if (v === "none") each.push({ AND: [{ judgements: { some: {} } }, { NOT: hit }] });
    // まだ一度も判定していない
    else if (v === "unjudged") each.push({ judgements: { none: {} } });
  }
  if (each.length === 0) return null;
  // 選択肢が複数選ばれたら「どれか」。すべて選ばれた状態は絞らないのと同じ
  return each.length === 1 ? (each[0] as Record<string, unknown>) : { OR: each };
}

/**
 * 各一覧のサーバー側の列定義。
 * 画面側の列定義とキーを一致させること（一致しない列は黙って無視される）。
 */

export const SUBSTANCE_COLUMNS: QueryColumn[] = [
  // コード・CAS は正規化列で突合する（全角や大小文字の違いを吸収するため）
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "casNumber", kind: "text", field: "casNormalized", normalize: normalizeCas },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "status", kind: "enum", field: "status" },
  { key: "publishState", kind: "enum", field: "publishState" },
  // 官報公示整理番号は子テーブル。番号でフィルターできるが並べ替えはできない
  {
    key: "gazetteNumbers",
    kind: "text",
    field: "number",
    relation: "gazetteNumbers",
    sortable: false,
  },
  // スコアとランクは計算して書いてある値。並べ替えも絞り込みもそのまま効く
  { key: "score", kind: "number", field: "score" },
  { key: "scoreRank", kind: "text", field: "scoreRank" },
  { key: "note", kind: "text", field: "note", caseInsensitive: true },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

/**
 * 製品の一覧で「確認が残っているか」で絞る。
 *
 * **「いいえ」は「印の付いていない行がある」ではない。**
 * 判定は区分ごとに何行もあるので、それだと確認が残っていても当たってしまう。
 * 「印の付いた行が1つも無い」で見る。
 */
function reviewCondition(values: string[]): Record<string, unknown> | null {
  const picked = [...new Set(values.map((v) => v === "true"))];
  const only = picked[0];
  // 両方選ばれているのは、絞っていないのと同じ
  if (only === undefined || picked.length > 1) return null;
  const flagged = { needsReview: true };
  return only ? { judgements: { some: flagged } } : { judgements: { none: flagged } };
}

/**
 * 製品の一覧で「この規制区分に当たっているもの」で絞る。
 *
 * **該当したものだけを見る。**非該当まで当てにすると、
 * 「調べたが当たらなかった」ものが「当たっている」側に混ざる。
 *
 *   すべて     … 選んだ区分に全部当たっているもの（AND）
 *   いずれか   … どれか1つでも当たっているもの（OR）
 */
function judgementCategoryCondition(
  values: string[],
  op: "all" | "any",
): Record<string, unknown> | null {
  const ids = [...new Set(values.filter((v) => v !== ""))];
  if (ids.length === 0) return null;
  const each = ids.map((id) => ({
    judgements: { some: { categoryId: id, verdict: "APPLICABLE" as const } },
  }));
  return op === "all" ? { AND: each } : { OR: each };
}

/**
 * 組成に、その名前の物質が入っているか。
 *
 * **CAS番号と違って、部分一致で見る。**名前は覚えかたが人によって違うので、
 * 完全一致にすると使えない（「鉛」で探して「鉛（別ロット）」が出ないなど）。
 *
 * **別名も見る。**社内での呼び方でしか覚えていないことがあるため。
 * 日本語・英語・別名のどれかに当たれば、その物質を含む製品とみなす。
 */
function substanceNameCondition(
  values: string[],
  op: "all" | "any",
): Record<string, unknown> | null {
  const words = [...new Set(values.map((v) => v.trim()).filter((v) => v !== ""))];
  if (words.length === 0) return null;
  const each = words.map((w) => ({
    compositionLines: {
      some: {
        substance: {
          OR: [
            { nameJa: { contains: w, mode: "insensitive" as const } },
            { nameEn: { contains: w, mode: "insensitive" as const } },
            {
              aliases: {
                some: {
                  OR: [
                    { nameJa: { contains: w, mode: "insensitive" as const } },
                    { nameEn: { contains: w, mode: "insensitive" as const } },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  }));
  return op === "all" ? { AND: each } : { OR: each };
}

export const PRODUCT_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "usableAsMaterial", kind: "enum", field: "usableAsMaterial", booleanEnum: true },
  { key: "status", kind: "enum", field: "status" },
  { key: "publishState", kind: "enum", field: "publishState" },
  { key: "modelValue", kind: "enum", field: "modelValue" },
  // 用途は子テーブル。「選んだもののどれかを持つ」で絞る
  { key: "uses", kind: "enum", field: "value", relation: "uses", sortable: false },
  // 組成をたどって物質のCAS番号で探す。値は完全一致（正規化して突合）
  {
    key: "casNumbers",
    kind: "list",
    field: "casNormalized",
    normalize: normalizeCas,
    relationPath: ["compositionLines", "substance"],
    sortable: false,
  },
  // 組成をたどって物質の名前で探す。こちらは部分一致（別名も見る）
  {
    key: "substanceNames",
    kind: "list",
    field: "nameJa",
    sortable: false,
    custom: (f) => (f.kind === "list" ? substanceNameCondition(f.values, f.op) : null),
  },
  { key: "note", kind: "text", field: "note", caseInsensitive: true },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
  // 判定は区分ごとの行を数えて決まるので、共通の組み立てには乗らない
  {
    key: "judgement",
    kind: "enum",
    field: "judgements",
    sortable: false,
    custom: (f) => (f.kind === "enum" ? judgementCondition(f.values) : null),
  },
  // 当たっている規制区分で絞る。区分のIDが値として来る
  {
    key: "judgementCategories",
    kind: "list",
    field: "categoryId",
    sortable: false,
    custom: (f) => (f.kind === "list" ? judgementCategoryCondition(f.values, f.op) : null),
  },
  // 「1つでも確認が残っているか」。区分ごとに見るのではない
  {
    key: "needsReview",
    kind: "enum",
    field: "needsReview",
    sortable: false,
    custom: (f) => (f.kind === "enum" ? reviewCondition(f.values) : null),
  },
];

export const REGION_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
];

export const COUNTRY_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  // 地域は選択式。値は地域のIDで送られる
  { key: "regionId", kind: "enum", field: "regionId" },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
];

export const LAW_COLUMNS: QueryColumn[] = [
  /*
    法律そのものを id で選ぶ。
    区分での絞り込みは、先に区分を探してから**その区分を持つ法律だけ**を出す。
    画面の側で切ると、いま出ているページに無い法律が落ちてしまう
  */
  { key: "id", kind: "list", field: "id" },
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameOriginal", kind: "text", field: "nameOriginal", caseInsensitive: true },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "countryId", kind: "enum", field: "countryId" },
  // 地域は国の1つ上。法律そのものは持っていないので、国をたどって絞る
  { key: "regionId", kind: "enum", field: "regionId", nested: "country" },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
];

/**
 * ドキュメント生成のテンプレート。
 * 中身（ブロックの並び）では絞れない。JSON なので、条件にすると当たり方が読めない
 */
export const DOC_TEMPLATE_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "target", kind: "enum", field: "target" },
  { key: "kind", kind: "enum", field: "kind" },
  { key: "locale", kind: "enum", field: "locale" },
  // はい/いいえ の列。真偽値に直さないと、DBに "true" という文字を渡して落ちる
  { key: "active", kind: "enum", field: "active", booleanEnum: true },
  { key: "usesRecipient", kind: "enum", field: "usesRecipient", booleanEnum: true },
  { key: "seq", kind: "number", field: "seq" },
  { key: "createdAt", kind: "date", field: "createdAt" },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

/**
 * 発行済みのドキュメント。
 * 中身（紙面）では絞れない。JSON なので、条件にすると当たり方が読めない
 */
export const DOCUMENT_COLUMNS: QueryColumn[] = [
  { key: "targetCode", kind: "text", field: "targetCode", caseInsensitive: true },
  // テンプレートは1対1。たどって絞る
  { key: "templateCode", kind: "text", field: "code", nested: "template", caseInsensitive: true },
  { key: "target", kind: "enum", field: "target", nested: "template" },
  { key: "hasComposition", kind: "enum", field: "hasComposition" },
  { key: "generatedAt", kind: "date", field: "generatedAt" },
];

export const REGULATION_CATEGORY_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameOriginal", kind: "text", field: "nameOriginal", caseInsensitive: true },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "lawId", kind: "enum", field: "lawId" },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
  // 人が付けた点数。法規制の一覧から「何点以上の区分か」で絞れるようにする
  { key: "score", kind: "number", field: "score" },
];

export const STATUTORY_SUBSTANCE_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "officialNumber", kind: "text", field: "officialNumber", caseInsensitive: true },
  { key: "nameOriginal", kind: "text", field: "nameOriginal", caseInsensitive: true },
  /*
    画面の「法文物質名」の列。**出しているのは原文・日本語・英語のうち1つ**
    （pickStatutoryName）なので、絞り込みも3つの欄をまたいで見る。
    日本語の欄だけを見ていたころは、LOLI から取り込んだ名前（原文の欄にしか無い）が
    素通りし、「トルエン」と打っても1件も出なかった。並べ替えは日本語の欄のまま
  */
  {
    key: "nameJa",
    kind: "text",
    field: "nameJa",
    caseInsensitive: true,
    custom: (f) =>
      f.kind === "text" ? anyOfTextCondition(["nameOriginal", "nameJa", "nameEn"], f) : null,
  },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "classId", kind: "enum", field: "classId" },
  {
    key: "applicableCondition",
    kind: "text",
    field: "applicableCondition",
    caseInsensitive: true,
  },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
];

export const METAL_FACTOR_COLUMNS: QueryColumn[] = [
  { key: "casNumber", kind: "text", field: "casNormalized", normalize: normalizeCas },
  // 元素記号は決まった集合なので、複数選べる enum で絞る（`in`）
  { key: "metalElement", kind: "enum", field: "metalElement" },
  { key: "ratioPct", kind: "number", field: "ratioPct" },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

export const NEWS_COLUMNS: QueryColumn[] = [
  { key: "titleJa", kind: "text", field: "titleJa", caseInsensitive: true },
  { key: "status", kind: "enum", field: "status" },
  { key: "pinned", kind: "enum", field: "pinned", booleanEnum: true },
  { key: "publishFrom", kind: "date", field: "publishFrom" },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

export const FEEDBACK_COLUMNS: QueryColumn[] = [
  { key: "title", kind: "text", field: "title", caseInsensitive: true },
  { key: "kind", kind: "enum", field: "kind" },
  { key: "priority", kind: "enum", field: "priority" },
  { key: "status", kind: "enum", field: "status" },
  { key: "body", kind: "text", field: "body", caseInsensitive: true },
  { key: "createdAt", kind: "date", field: "createdAt" },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

/**
 * セッションの状態。**表の列としては持たず、時刻から決める。**
 *   active … 生きていて、最終操作が自動ログアウトの時間の内
 *   idle   … 生きているが、最終操作から自動ログアウトの時間を過ぎている（次の操作で切れる）
 *   ended  … 終わった（自分で・放置・期限・設定変更・メンテナンス・管理者）か、期限が切れた
 */
export function sessionStatusCondition(
  values: string[],
  now: Date,
  idleMs: number,
): Record<string, unknown> | null {
  const idleCutoff = new Date(now.getTime() - idleMs);
  const alive = { endedAt: null, expiresAt: { gt: now } };
  const each: Record<string, unknown>[] = [];
  for (const v of new Set(values)) {
    if (v === "active") each.push({ ...alive, lastSeenAt: { gte: idleCutoff } });
    else if (v === "idle") each.push({ ...alive, lastSeenAt: { lt: idleCutoff } });
    else if (v === "ended")
      each.push({ OR: [{ endedAt: { not: null } }, { expiresAt: { lte: now } }] });
  }
  if (each.length === 0) return null;
  return each.length === 1 ? (each[0] as Record<string, unknown>) : { OR: each };
}

/**
 * セッション管理。利用者の欄は子テーブル（user）なので絞り込みだけ。
 * 状態は時刻で決まるので、いま（now）と自動ログアウトの時間を渡して組む
 */
export function sessionColumns(now: Date, idleMs: number): QueryColumn[] {
  return [
    {
      key: "status",
      kind: "enum",
      field: "endedAt",
      sortable: false,
      custom: (f) => (f.kind === "enum" ? sessionStatusCondition(f.values, now, idleMs) : null),
    },
    {
      key: "email",
      kind: "text",
      field: "email",
      nested: "user",
      caseInsensitive: true,
      sortable: false,
    },
    {
      key: "displayName",
      kind: "text",
      field: "displayName",
      nested: "user",
      caseInsensitive: true,
      sortable: false,
    },
    { key: "createdAt", kind: "date", field: "createdAt" },
    { key: "lastSeenAt", kind: "date", field: "lastSeenAt" },
    { key: "expiresAt", kind: "date", field: "expiresAt" },
    { key: "endedAt", kind: "date", field: "endedAt" },
    { key: "ipAddress", kind: "text", field: "ipAddress" },
  ];
}

export const USER_COLUMNS: QueryColumn[] = [
  { key: "email", kind: "text", field: "email", caseInsensitive: true },
  { key: "displayName", kind: "text", field: "displayName", caseInsensitive: true },
  { key: "activeFlag", kind: "enum", field: "activeFlag", booleanEnum: true },
  { key: "lastLoginAt", kind: "date", field: "lastLoginAt" },
];

export const GROUP_COLUMNS: QueryColumn[] = [
  { key: "kind", kind: "enum", field: "kind" },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
  { key: "activeFlag", kind: "enum", field: "activeFlag", booleanEnum: true },
];

/** 組織（会社・事業所）。項目は表に出さないので、ここには入れない */
export const ORGANISATION_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "code", caseInsensitive: true },
  { key: "kind", kind: "enum", field: "kind" },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
  { key: "activeFlag", kind: "enum", field: "activeFlag", booleanEnum: true },
];

export const PROPERTY_DEF_COLUMNS: QueryColumn[] = [
  // 用途は節ごとに固定（画面には出さないが、節から必ず条件として送られる）
  { key: "target", kind: "enum", field: "target" },
  { key: "key", kind: "text", field: "key", caseInsensitive: true },
  { key: "labelJa", kind: "text", field: "labelJa", caseInsensitive: true },
  { key: "dataType", kind: "enum", field: "dataType" },
  { key: "defaultUnit", kind: "text", field: "defaultUnit", caseInsensitive: true },
  { key: "displayOrder", kind: "number", field: "displayOrder" },
  { key: "activeFlag", kind: "enum", field: "activeFlag", booleanEnum: true },
];

export const ELEMENT_COLUMNS: QueryColumn[] = [
  { key: "symbol", kind: "text", field: "symbol", caseInsensitive: true },
  { key: "atomicNumber", kind: "number", field: "atomicNumber" },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
];

export const SOURCE_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "code", caseInsensitive: true },
  { key: "note", kind: "text", field: "note", caseInsensitive: true },
];

export const LINK_VERSION_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "code", caseInsensitive: true },
  { key: "isCurrent", kind: "enum", field: "isCurrent" },
];

export const LINK_VERSION_SOURCE_COLUMNS: QueryColumn[] = [
  { key: "priority", kind: "number", field: "priority" },
  { key: "note", kind: "text", field: "note", caseInsensitive: true },
  { key: "loadedAt", kind: "date", field: "loadedAt" },
];

export const INVENTORY_COLUMNS: QueryColumn[] = [
  { key: "code", kind: "text", field: "codeNormalized", normalize: normalizeCode },
  { key: "nameOriginal", kind: "text", field: "nameOriginal", caseInsensitive: true },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  { key: "countryId", kind: "enum", field: "countryId" },
  // 地域は国の1つ上。インベントリそのものは持っていないので、国をたどって絞る（法律と同じ）
  { key: "regionId", kind: "enum", field: "regionId", nested: "country" },
  { key: "numberLabel", kind: "text", field: "numberLabel", caseInsensitive: true },
  { key: "numberShown", kind: "enum", field: "numberShown", booleanEnum: true },
  { key: "numberOrder", kind: "number", field: "numberOrder" },
];

/**
 * インベントリの中身。
 *
 * **バージョン・データソース・インベントリは、ここには置かない。**
 * どれも表の上のプルダウンと URL で決まるもので、API 側が条件に足す。
 * フィルターに二重に置くと、同じことを決める操作が2か所になる
 */
export const INVENTORY_ROW_COLUMNS: QueryColumn[] = [
  { key: "casNumber", kind: "text", field: "casNormalized", normalize: normalizeCas },
  { key: "value", kind: "text", field: "value", caseInsensitive: true },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

/** 法文物質名・法律・区分・分類が持つ名前の3欄。画面には1つを選んで出すので、絞り込みは3つをまたぐ */
const NAME_FIELDS = ["nameOriginal", "nameJa", "nameEn"];

type Where = Record<string, unknown>;
/** リンクの行から、法文物質名 → 分類 → 区分 → 法律 と掘る */
const underSubstance = (w: Where): Where => ({ statutorySubstance: w });
const underClass = (w: Where): Where => underSubstance({ regulationClass: w });
const underCategory = (w: Where): Where => underClass({ category: w });
const underLaw = (w: Where): Where => underCategory({ law: w });
const wrap = (into: (w: Where) => Where, w: Where | null) => (w ? into(w) : null);

/**
 * 外部データベースの「対象CAS」の表（`/api/cas-links`）。
 * 1つのバージョン × 1つのデータソースの全リンクを、法文物質名をまたいで並べる。
 * バージョンとデータソースは絞り込みの列ではなく、上の表で選んだものが API に付く。
 * 「採用」と「物質名」はここに無い（採用はページの行だけで決める。物質名は API が先に CAS を集める）
 */
/**
 * 対象CASの表と、その差分の表で共通の列（法文物質名の側から掘るもの）。
 * どちらの表の行にも `statutorySubstance` と `casNormalized` がある
 */
const CAS_LINK_SCOPE_COLUMNS: QueryColumn[] = [
  {
    key: "regionId",
    kind: "enum",
    field: "regionId",
    custom: (f) =>
      f.kind === "enum" && f.values.length > 0
        ? underLaw({ country: { regionId: { in: f.values } } })
        : null,
  },
  {
    key: "countryId",
    kind: "enum",
    field: "countryId",
    custom: (f) =>
      f.kind === "enum" && f.values.length > 0 ? underLaw({ countryId: { in: f.values } }) : null,
  },
  {
    key: "lawName",
    kind: "text",
    field: "lawName",
    custom: (f) => (f.kind === "text" ? wrap(underLaw, anyOfTextCondition(NAME_FIELDS, f)) : null),
  },
  {
    key: "categoryName",
    kind: "text",
    field: "categoryName",
    custom: (f) =>
      f.kind === "text" ? wrap(underCategory, anyOfTextCondition(NAME_FIELDS, f)) : null,
  },
  {
    key: "className",
    kind: "text",
    field: "className",
    custom: (f) =>
      f.kind === "text" ? wrap(underClass, anyOfTextCondition(NAME_FIELDS, f)) : null,
  },
  {
    key: "officialNumber",
    kind: "text",
    field: "officialNumber",
    custom: (f) =>
      f.kind === "text" ? wrap(underSubstance, anyOfTextCondition(["officialNumber"], f)) : null,
  },
  {
    key: "statutoryName",
    kind: "text",
    field: "statutoryName",
    custom: (f) =>
      f.kind === "text" ? wrap(underSubstance, anyOfTextCondition(NAME_FIELDS, f)) : null,
  },
  { key: "casNumber", kind: "text", field: "casNormalized", normalize: normalizeCas },
  // 物質名（代表物質）。条件は API が先に物質マスタから CAS を集めて付けるので、ここでは何もしない
  { key: "casName", kind: "text", field: "casNormalized", sortable: false, custom: () => null },
];

export const CAS_LINK_COLUMNS: QueryColumn[] = [
  ...CAS_LINK_SCOPE_COLUMNS,
  { key: "excluded", kind: "enum", field: "excluded", booleanEnum: true },
  {
    /*
      出どころの文章は別テーブル（無いリンクのほうが多い）。
      「空」は行が無いこと、「空でない」は行があること。それ以外は原文と日本語訳の両方を見る
    */
    key: "data",
    kind: "text",
    field: "data",
    sortable: false,
    custom: (f) => {
      if (f.kind !== "text") return null;
      if (f.op === "empty") return { data: null };
      if (f.op === "notEmpty") return { data: { isNot: null } };
      return wrap((w) => ({ data: w }), anyOfTextCondition(["text", "textJa"], f));
    },
  },
  { key: "note", kind: "text", field: "note", caseInsensitive: true },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
];

/**
 * 差分の表（`/api/cas-links/diff`）。共通の列に「種類」が付く。
 * 該非・出典データ・備考は前後2つあるので、ここでは絞らない（画面でも絞り込みを出さない）
 */
export const CAS_LINK_DIFF_COLUMNS: QueryColumn[] = [
  { key: "kind", kind: "enum", field: "kind" },
  ...CAS_LINK_SCOPE_COLUMNS,
];
