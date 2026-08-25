import type { MfaMethod } from "@chem/shared";
import type {
  GazetteLawKind,
  GroupKind,
  Permission,
  ProductStatus,
  PublishState,
  PropertyDataType,
  PropertyTarget,
  SubstanceStatus,
  ThresholdBound,
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
  /** 2要素認証のやりかた。none（使わない）/ totp（認証アプリ） */
  mfaMethod: MfaMethod;
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

/**
 * アクセス記録の1行。
 *
 * ログインの出来事と、データが外へ出る出来事を**同じ並びで**出す。
 * 分けると「見慣れない場所から入って、そのあと組成を立て続けに開いた」
 * という流れが見えなくなる。事故のときに、いちばん見たいのがそれ。
 *
 * 利用者名・製品名は記録そのものには入っていない（二重に持つと食い違うため）。
 * 表に出すときに引いて組み立てる。消えていれば null。
 */
export interface AccessLogDto {
  id: string;
  at: string;
  /** login / login_failed / logout / view / export / import */
  action: string;
  actorId: string | null;
  actorName: string | null;
  /** 試されたメールアドレス。ログインの失敗では、利用者が特定できないことがある */
  email: string | null;
  /** 失敗の理由。それ以外では null */
  reason: string | null;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  /** 見た行数。多い日が続く人は、まとめて持ち出している */
  lineCount: number | null;
  /** 末端の物質まで下ろした表かどうか */
  expanded: boolean | null;
  ip: string | null;
  /** 接続元のおよその国（2文字）。"local" は自分自身、null は分からない */
  country: string | null;
  userAgent: string | null;
}

/** 気になる動きの種類 */
export type AccessRiskKind =
  "repeatedFailure" | "unknownAccount" | "lockout" | "foreignLogin" | "nightLogin" | "bulkView";

/** アクセス記録の分析。数えた結果だけを返す */
export interface AccessStatsDto {
  /** 何日ぶんを数えたか */
  days: number;
  totals: { login: number; failed: number; view: number; lockouts: number };
  /** 時間帯ごと（0〜23時）。いつ使われているかを見る */
  byHour: { hour: number; login: number; failed: number; view: number }[];
  /** 失敗の多い相手。上から順 */
  topFailedUsers: { email: string; count: number }[];
  topFailedIps: { ip: string; country: string | null; count: number }[];
  /** 組成をよく見ている人。上から順 */
  topViewers: { name: string; count: number; lines: number }[];
  /** 気になる動き。件数の多いものから */
  risks: {
    kind: AccessRiskKind;
    count: number;
    /** 具体例（アドレス・利用者名・国など）。多いものから3つまで */
    samples: string[];
  }[];
}

/**
 * 判定の根拠1件（当たった法文物質名1つぶん）。
 * 製品から見る場合も、法規制の区分から見る場合も同じ形。
 */
export interface JudgementHitDto {
  /** 法文物質名。区分そのものが当たったときは空 */
  name: string | null;
  /** 法令が付けている番号（政令番号など） */
  officialNumber: string | null;
  /**
   * その値を作ったCASと、それぞれの寄与。まとめたときは複数並ぶ。
   * 「なぜその合計になったのか」を追えるようにするため
   */
  contributions: { cas: string; pct: string }[];
  /** 合算した含有率。**まとめたときだけ入る**（足していないものを足したように見せない） */
  total: string | null;
}

/**
 * 製品ごと・区分ごとの法規制判定。
 *
 * 判定（該当／非該当）と「人が見たかどうか」を**別に持つ**。
 * 根拠は組成そのものに近い情報なので、組成を見られない人には出さない。
 */
export interface ProductJudgementDto {
  categoryId: string;
  lawCode: string;
  lawNameJa: string | null;
  lawNameEn: string | null;
  lawNameOriginal: string;
  categoryNameJa: string | null;
  categoryNameEn: string | null;
  categoryNameOriginal: string;

  verdict: "APPLICABLE" | "NOT_APPLICABLE";
  /** システムが出したか、人が上書きしたか */
  source: "SYSTEM" | "USER";
  /** 人が見なければ決められない、という印。確認すると消える */
  needsReview: boolean;
  /** なぜ要確認なのか。文言は画面側で付ける */
  reviewReasons: string[];

  decidedByName: string | null;
  decidedAt: string | null;
  decidedNote: string | null;
  computedAt: string;

  /** 何が何％入っていたから該当なのか。組成を見られない人には空 */
  hits: JudgementHitDto[];
  /** 根拠を伏せているかどうか。空なのか伏せたのかを、画面で区別するため */
  hitsWithheld: boolean;
}

/**
 * 法規制の画面から見た「この区分に当たる製品」（逆引き）。
 *
 * 製品の判定（`ProductJudgementDto`）と向きが逆なので、
 * 法令・区分の名前は持たない（見ている区分そのものだから）。
 */
export interface MatchedProductDto {
  productId: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  status: ProductStatus;
  /**
   * 該当か非該当か。
   * **非該当のものも並ぶ。**確認が残っている（引っかからないと言い切れていない）ものは、
   * 法規制の側から見たときにこそ知りたいため
   */
  verdict: "APPLICABLE" | "NOT_APPLICABLE";
  /** システムが出したか、人が上書きしたか */
  source: "SYSTEM" | "USER";
  /** 確認が残っているか */
  needsReview: boolean;
  reviewReasons: string[];
  computedAt: string;
  /** 何が何％入っていたから該当なのか。組成を見られない人には空 */
  hits: JudgementHitDto[];
  /** 根拠を伏せているかどうか。空なのか伏せたのかを、画面で区別するため */
  hitsWithheld: boolean;
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
  /** 官報公示整理番号（区分つき）。編集はしないが、保存時にそのまま送り返す */
  gazetteNumbers: { lawKind: GazetteLawKind; number: string }[];
  /**
   * 各種番号（官報公示整理番号・EC番号など）。インベントリから引いたもの。
   * 一覧では1セルに複数行で出す（決定 0008）
   */
  numbers: { label: string; number: string }[];
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
  /**
   * 一度でも判定したか。**false は「該当なし」ではなく「まだ調べていない」。**
   * 組成が登録されていない製品はここが false のまま
   */
  judged: boolean;
  /** 該当した規制区分の数。判定していなければ 0 */
  hitCount: number;
  /** 確認が残っている区分が1つでもあるか */
  needsReview: boolean;
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

/** 言語。法規制の「原文の言語」で選ぶ */
export interface LanguageDto {
  id: string;
  /** ISO 639-1 を大文字にした2文字（JA, EN …） */
  code: string;
  nameJa: string;
  nameEn: string;
  displayOrder: number;
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

/** 法令。国の配下に置く */
export interface LawDto {
  id: string;
  code: string;
  countryId: string;
  countryNameJa: string;
  countryNameEn: string | null;
  /** 国の1つ上。アジア・欧州など。どのあたりの法令かが一目で分かる */
  regionId: string;
  regionNameJa: string;
  regionNameEn: string | null;
  nameOriginal: string;
  nameLang: string;
  nameJa: string | null;
  nameEn: string | null;
  displayOrder: number;
  note: string | null;
  /** ぶら下がっている区分の数 */
  categoryCount: number;
}

/** 区分。判定の骨組みで、閾値のひな型を持つ */
export interface RegulationCategoryDto {
  id: string;
  code: string;
  lawId: string;
  nameOriginal: string;
  nameLang: string;
  nameJa: string | null;
  nameEn: string | null;
  thresholdLower: string;
  lowerBound: ThresholdBound;
  thresholdUpper: string;
  upperBound: ThresholdBound;
  interactionGroup: string | null;
  rank: number | null;
  displayOrder: number;
  /**
   * 番号のリストとしての呼び名（「官報公示整理番号」「EC番号」など）。
   * 入っていれば、この区分の番号が物質の画面に並ぶ
   */
  numberLabel: string | null;
  note: string | null;
  /** 配下の法文物質名の数（表示名のない分類のぶんも含む） */
  substanceCount: number;
}

/** 分類。名前が無いものは画面に出さない受け皿 */
export interface RegulationClassDto {
  id: string;
  code: string;
  categoryId: string;
  nameOriginal: string | null;
  nameLang: string | null;
  nameJa: string | null;
  nameEn: string | null;
  displayOrder: number;
  substanceCount: number;
}

/** 法文物質名。判定はこの行の閾値だけを読む */
export interface StatutorySubstanceDto {
  id: string;
  code: string;
  classId: string;
  officialNumber: string | null;
  nameOriginal: string;
  nameLang: string;
  nameJa: string | null;
  nameEn: string | null;
  thresholdLower: string;
  lowerBound: ThresholdBound;
  thresholdUpper: string;
  upperBound: ThresholdBound;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  displayOrder: number;
  note: string | null;
  /** 現在版で結ばれているCASの数 */
  casCount: number;
}

/** 法文物質名とCAS番号の結び付き。1つのCASにデータソースの数だけ行が並ぶ */
export interface StatutoryCasLinkDto {
  id: string;
  versionId: string;
  statutorySubstanceId: string;
  sourceId: string;
  sourceCode: string;
  casNumber: string;
  casNormalized: string;
  /** そのCASの代表物質。物質マスタに無ければ null */
  substanceId: string | null;
  substanceNameJa: string | null;
  substanceNameEn: string | null;
  /** 立っていれば「該当しない」。下位のデータソースの内容を打ち消す */
  excluded: boolean;
  note: string | null;
  /** 優先度で解いた結果、このCASの答えとして採られている行か */
  used: boolean;
  /** データソースがこの版に並んでいない。優先度が決まらないので採られることがない */
  orphan: boolean;
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

/** 元素。法文物質名の「換算先」で選ぶ */
export interface ElementDto {
  symbol: string;
  atomicNumber: number;
  nameJa: string;
  nameEn: string;
}

/** 情報源（LOLI・CHRIP・自社データなど）。どの版で使うかは版の側で決める */
export interface SourceDto {
  id: string;
  code: string;
  /** 説明。どんなデータで、どこまで載っているか */
  note: string | null;
}

/**
 * バージョン。いつ時点のデータかを押さえるためのもの。
 * 持つのはコードだけ。中身の件数はデータソースの側で見る
 */
export interface LinkSetVersionDto {
  id: string;
  code: string;
  /** 判定に使うバージョン。システム全体で1件だけ */
  isCurrent: boolean;
  /** 利用者が選んだものか。立っていなければ自動（コード順でいちばん新しいもの） */
  currentPinned: boolean;
}

/** データソース（バージョン × データソース種別）。取り込みの単位でもある */
export interface LinkVersionSourceDto {
  id: string;
  versionId: string;
  versionCode: string;
  sourceId: string;
  sourceCode: string;
  /** 小さいほど優先。同じバージョンの中で重複しない */
  priority: number;
  note: string | null;
  loadedAt: string | null;
  /** この組み合わせで入っているリンクの数 */
  linkCount: number;
}
