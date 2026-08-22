import type {
  GazetteLawKind,
  GroupKind,
  Permission,
  ProductStatus,
  PublishState,
  PropertyDataType,
  PropertyTarget,
  SubstanceStatus,
} from "@chem/shared";

/**
 * 画面が使う API レスポンスの型。
 * 各ステップで対象の DTO を追記していく（S5 物質 / S7 製品 …）。
 */

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

/** GET /api/me — 画面の出し分け用。認可の判断はサーバー側で別途行う */
export interface MeDto {
  id: string;
  email: string;
  displayName: string | null;
  permissions: Permission[];
  canEdit: boolean;
  isAdmin: boolean;
  preferredLocale: string | null;
}

export interface UserSummaryDto {
  id: string;
  email: string;
  displayName: string | null;
  activeFlag: boolean;
  hasPassword: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  permissions: Permission[];
  orgGroupId: string | null;
  orgGroupName: string | null;
  orgGroupNameEn: string | null;
  newsGroupId: string | null;
  newsGroupName: string | null;
  newsGroupNameEn: string | null;
}

export interface GroupDto {
  id: string;
  kind: GroupKind;
  nameJa: string;
  nameEn: string | null;
  displayOrder: number;
  activeFlag: boolean;
  /** 用途に応じた所属人数（削除の影響を知らせるため） */
  memberCount: number;
  /** この分類が付いたお知らせの数 */
  newsCount: number;
}

/** 保存したフィルター。共有されたものは他人が作ったものも並ぶ */
export interface SavedFilterDto {
  id: string;
  tableKey: string;
  title: string;
  /** 並べ替え・フィルター・件数をまとめたクエリ文字列 */
  query: string;
  shared: boolean;
  /** 自分が保存したものか（消せるかどうかの判断に使う） */
  mine: boolean;
  ownerName: string;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SubstanceListItemDto {
  id: string;
  code: string;
  casNumber: string | null;
  status: SubstanceStatus;
  /** 公開の状態。公開済になるまで他の人には見えない */
  publishState: PublishState;
  nameJa: string;
  nameEn: string | null;
  note: string | null;
  aliasCount: number;
  /** 官報公示整理番号（区分つき）。一覧では1セルに複数行で出す */
  gazetteNumbers: { lawKind: GazetteLawKind; number: string }[];
  updatedAt: string;
}

export interface SubstanceDetailDto extends SubstanceListItemDto {
  mainNameJa: string;
  mainNameEn: string | null;
  subNames: { nameJa: string | null; nameEn: string | null }[];
  properties: PropertyValueDto[];
  /** このCASを代表する物質か。合算した行に出す名称をこの物質から取る */
  casRepresentative: boolean;
}

/** 同じCAS番号の、生きている他の物質。代表を選ばせるときに並べる */
export interface CasSiblingDto {
  id: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  status: SubstanceStatus;
  isCasRepresentative: boolean;
}

/** 拡張属性の値。物質と製品で同じ形（数値は文字列で受け渡す） */
export interface PropertyValueDto {
  propertyDefId: string;
  valueText: string | null;
  valueNum: string | null;
  unit: string | null;
}

export interface ProductListItemDto {
  id: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  status: ProductStatus;
  /** 公開の状態。公開済になるまで他の人には見えない */
  publishState: PublishState;
  note: string | null;
  aliasCount: number;
  /** 他製品の組成に部品として使えるか */
  usableAsMaterial: boolean;
  /** 型式。未選択は null */
  modelValue: string | null;
  /** 用途。表示順に並べた文字列 */
  uses: string[];
  updatedAt: string;
}

export interface ProductDetailDto extends ProductListItemDto {
  aliases: { nameJa: string | null; nameEn: string | null }[];
  properties: PropertyValueDto[];
}

/** 組成の構成要素（物質でも原材料でも同じ形で見せる） */
export interface CompositionElementDto {
  id: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  /** 物質のCAS番号。原材料（子製品）は持たないので null */
  casNumber: string | null;
  /**
   * 原材料が、自分の組成を持っているか。物質は常に false。
   * 開いても何も出ない行に、展開の印を出さないために使う。
   */
  hasComposition: boolean;
}

/** 検索で出す候補。物質か原材料かを添えて返す */
export interface CompositionCandidateDto extends CompositionElementDto {
  kind: "substance" | "product";
}

export interface CompositionLineDto {
  id: string;
  substanceId: string | null;
  childProductId: string | null;
  /** 残部の行は null。数値は文字列で受け渡す */
  contentPct: string | null;
  isBalance: boolean;
  note: string | null;
  element: CompositionElementDto | null;
}

export interface CompositionResponse {
  lines: CompositionLineDto[];
  /** 既知成分（残部を除く）の合計 */
  totalPct: string;
  /** 残部の行に入る値。残部の行が無ければ null */
  balancePct: string | null;
}

/**
 * CASでまとめた行の、1件ぶんの寄与元。
 * どの原材料から来たかは登録組成のほうを見れば分かるので、ここには持たない。
 */
export interface AggregateContributionDto {
  /** 物質コード。同じCASの別の物質を見分けるのに使う */
  code: string;
  /**
   * まとめる前の物質名。
   * まとめた行の名称は代表物質のものなので、寄与元と食い違うことがある。
   * 空欄にすると「入っていない」と読まれるため、同じ名前でもそのまま出す。
   */
  nameJa: string;
  nameEn: string | null;
  /** 製品全体に対する重量% */
  pct: string;
}

/** CASでまとめた行。合算の結果はこの形で返す */
export interface AggregateRowDto {
  /** CAS番号。持たない物質は null（まとめようがないので1物質1行になる） */
  casNumber: string | null;
  /** 代表物質のコードと名称。CASを持たない物質は自分自身のもの */
  code: string;
  nameJa: string;
  nameEn: string | null;
  totalPct: string;
  contributions: AggregateContributionDto[];
}

export interface CompositionAggregateDto {
  /** 重量%の多い順 */
  rows: AggregateRowDto[];
  /** すべて展開できていれば 100 になる。届かないときは下の blocked を見る */
  totalPct: string;
  /** 展開できなかった原材料。この表が不完全であることを示す */
  blocked: {
    code: string;
    nameJa: string;
    nameEn: string | null;
    /** その原材料が製品全体に占める重量% */
    pct: string;
    reason: "empty" | "notFound";
  }[];
  /** 深さの上限で打ち切った枝の数 */
  truncated: number;
}

/** 地域（アジア・欧州など）。国は含まない */
export interface RegionDto {
  id: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  displayOrder: number;
}

/** 国。法令の持ち主になる単位で、地域の配下に置く */
export interface CountryDto {
  id: string;
  code: string;
  regionId: string;
  regionNameJa: string;
  regionNameEn: string | null;
  nameJa: string;
  nameEn: string | null;
  displayOrder: number;
}

export interface MetalFactorDto {
  id: string;
  casNumber: string;
  metalElement: string;
  /** 重量パーセント。数値は文字列で受け渡す */
  ratioPct: string;
  updatedAt: string;
  /** このCASを持つ物質（物理FKは無く、正規化CASで突き合わせた結果） */
  matchedSubstances: { id: string; code: string; nameJa: string; nameEn: string | null }[];
}

export interface PropertyDefDto {
  id: string;
  /** 物質用か製品用か。キーは用途ごとに一意 */
  target: PropertyTarget;
  key: string;
  labelJa: string;
  labelEn: string | null;
  dataType: PropertyDataType;
  defaultUnit: string | null;
  displayOrder: number;
  activeFlag: boolean;
  /** この項目に値が入っている件数（削除の影響を知らせるため）。用途側だけを数える */
  valueCount: number;
}

export interface NewsDto {
  id: string;
  titleJa: string;
  bodyJa: string;
  titleEn: string | null;
  bodyEn: string | null;
  status: "DRAFT" | "PUBLISHED";
  pinned: boolean;
  /** YYYY-MM-DD（未設定は null） */
  publishFrom: string | null;
  publishUntil: string | null;
  authorId: string;
  authorName: string;
  /** 投稿者の所属（現在の所属。過去の投稿でも今の所属が出る） */
  authorOrgNameJa: string | null;
  authorOrgNameEn: string | null;
  /** ホームの見出しを分けるための分類（投稿時に投稿者のグループを写し取る） */
  groupId: string | null;
  groupNameJa: string | null;
  groupNameEn: string | null;
  groupOrder: number | null;
  updatedAt: string;
  /** この閲覧者が編集できるか（サーバー側で判断済み） */
  editable: boolean;
}
