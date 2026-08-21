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
