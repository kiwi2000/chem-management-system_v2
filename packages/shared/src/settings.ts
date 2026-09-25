import { z } from "zod";
import {
  DEFAULT_DOC_FILE_NAME_PATTERN,
  DEFAULT_DOC_OUTPUT_DIR,
  unknownFileNamePlaceholders,
} from "./doc-file-name";
import { COMPOSITION_VALIDATION_MODES, type CompositionValidationMode } from "./composition";
import { toScaled } from "./decimal";
import type { Messages } from "./i18n/ja";

/**
 * システム設定。
 * 値は SystemSetting テーブルに文字列で入れ、ここで型付きに読み替える。
 * 設定を増やすときは AppSettings・DEFAULT_SETTINGS・SETTING_DEFS・settingsSchema の4か所を揃えること。
 * （サーバーだけが書く値は settingsSchema に載せず、保存側で前の値を引き継ぐ）
 */

/**
 * 2要素認証のやりかた。
 *  none … 使わない
 *  totp … 認証アプリが出す6桁（30秒ごとに変わる）
 * メール認証は将来足す可能性があるので、真偽値ではなく方式で持つ。
 */
export const MFA_METHODS = ["none", "totp"] as const;
export type MfaMethod = (typeof MFA_METHODS)[number];

/**
 * 条件つきのCASリンクをどう扱うか。
 *
 * 外部データベース（LOLI）は、総称（「キシレノール」）から個々の異性体へ結び付け、
 * 「法律の名称が定める条件に合致すること」という但し書きを付けることがある。
 * 法律の名称が「２，４－キシレノール」と絞っていても、３，５－体まで結ばれる。
 *
 *  hit    … 「要確認」を付けない
 *  review … 「要確認」を付ける
 *
 * どちらでも**警告は必ず出る。**違いは、人の確認を必須にするかどうか。
 */
export const CONDITIONAL_LINK_MODES = ["hit", "review"] as const;
export type ConditionalLinkMode = (typeof CONDITIONAL_LINK_MODES)[number];

export interface AppSettings {
  /**
   * メンテナンスモード。**管理者以外はログインできず、入っている人も次の操作で切れる。**
   * データの入れ替えや判定のやり直しのあいだ、途中の状態を見せないために使う
   */
  maintenanceMode: boolean;
  /** CAS番号を必須にする。false なら空欄で登録できる */
  casRequired: boolean;
  /** CAS番号の形（例: 7439-92-1）を強制する。false なら形が違っても警告だけで保存できる */
  casFormatEnforced: boolean;

  /** 組成の含有率合計をどのくらい厳しく見るか */
  compositionValidationMode: CompositionValidationMode;
  /** 合計を 100% と見なす許容誤差（%）。数値は文字列で持つ */
  compositionEpsilonPct: string;

  /**
   * 条件つきのCASリンクの扱い。
   * `hit` は該非を確定して警告、`review` は要確認にして警告。
   */
  conditionalLinkMode: ConditionalLinkMode;

  /** 製品の「型式」で選べる値。並べた順がそのまま表示順になる */
  productModelOptions: string[];
  /** 製品の「用途」で選べる値。並べた順がそのまま表示順になる */
  productUseOptions: string[];

  /**
   * 規制区分に入れられるスコアの範囲。**数値は文字列で持つ**（小数を落とさないため）。
   * 範囲の外は保存できない。人が付ける点数なので、決め方は運用側に委ねる
   */
  categoryScoreMin: string;
  categoryScoreMax: string;

  /** 物質を公開するのに承認が要るか。false なら「発行」で直接公開できる */
  substanceApprovalRequired: boolean;
  /** 製品を公開するのに承認が要るか。同上 */
  productApprovalRequired: boolean;

  /**
   * パスワードの決まり。これから設定するパスワードにだけ効く。
   * 決まりを厳しくしても、すでに使われているパスワードは無効にならない
   * （ログインできなくなる人が出るため）。
   */
  passwordMinLength: number;
  /** 英字を1文字以上入れさせる */
  passwordRequireLetter: boolean;
  /** 数字を1文字以上入れさせる */
  passwordRequireDigit: boolean;
  /**
   * パスワードの有効期限（日）。**0 なら期限なし**（2026-09-17 指示）。
   * 期限を過ぎた人は、次にログインしたときパスワード変更の画面から動けなくなる。
   * 決まり（最小文字数など）と違い、**すでに使われているパスワードにも効く**
   */
  passwordExpiryDays: number;
  /**
   * 期限の何日前から「あと何日」と知らせるか。**0 なら知らせない**（2026-09-17 指示）。
   * 予告が無いと、期限の日に突然入れなくなり、問い合わせがその日にまとまる
   */
  passwordExpiryWarnDays: number;
  /**
   * 操作が無いまま、この分数を過ぎたらログアウトさせる。
   * 席を離れた端末が開いたままになるのを防ぐ。
   */
  sessionIdleMinutes: number;
  /**
   * 2要素認証を全員に求める。
   * 入にすると、利用者は「使わない」を選べなくなる。
   * 全員が設定を済ませてから入にする（先に入にすると設定前の人が入れなくなる）
   */
  mfaRequired: boolean;
  /** 記号を1文字以上入れさせる */
  passwordRequireSymbol: boolean;
  /**
   * 記号とみなす文字。ここに並べた文字だけを記号として数える。
   * 空にすると、英数字と空白以外のすべてを記号として扱う。
   */
  passwordSymbolChars: string;
  /** 大文字と小文字を両方入れさせる（英字を使う場合のみ意味を持つ） */
  passwordRequireMixedCase: boolean;

  /**
   * 帳票（PDF）を置くフォルダー。**相対の道筋はアプリのフォルダーから数える**（既定 data/documents。
   * お客さんの環境ごとに違う絶対の道筋を決め打ちしないため）。絶対の道筋も書ける。
   * 外からは直接見えない場所に置き、取り出しは API を通す。保存するときに、あるか・書けるかを確かめる（2026-09-16 指示）
   */
  documentOutputDir: string;
  /** 帳票のファイル名の書式。差込みは doc-file-name.ts（例: {テンプレート}_{対象コード}_{日付}） */
  documentFileNamePattern: string;

  /**
   * 画像ライブラリに入れるときの整えかた（2026-09-16 指示）。
   * 長辺がこれより大きい画像は縮める。印刷 300dpi なら A4 いっぱいでも 2,100px ほどで足りる
   */
  imageMaxEdgePx: number;
  /** 形式。keep = PNG は PNG、JPEG は JPEG のまま（それ以外は PNG に）。png / jpeg = すべてその形式に */
  imageFormat: ImageFormatPolicy;
  /** JPEG にするときの画質（1〜100） */
  imageJpegQuality: number;

  /**
   * システムの名前（2026-09-25 指示）。上の帯の題字・ログイン画面・ブラウザのタブに出る。
   * **空なら辞書の既定の名前**（ケミカルコンプライアンス支援システム / Chemical Compliance Support）
   */
  appNameJa: string;
  appNameEn: string;
  /**
   * 題字の横に置くアイコン。画像そのものは system_settings の `ui.header_icon` の行に
   * （`mime;base64,…` の形で）持ち、SETTING_DEFS には載せない（毎回の設定読みで運ばないため）。
   * ここに持つのは**預けた時刻**で、空なら「アイコン無し」。URL に付けてブラウザの覚えを切り替える
   */
  headerIconVersion: string;
  /** 題字の左右どちらに置くか */
  headerIconPosition: HeaderIconPosition;
}

export const HEADER_ICON_POSITIONS = ["left", "right"] as const;
export type HeaderIconPosition = (typeof HEADER_ICON_POSITIONS)[number];
/** アイコンの本体を入れる system_settings のキー（SETTING_DEFS の外） */
export const HEADER_ICON_DATA_KEY = "ui.header_icon";
/** システム名の上限（帯に収まる長さ。題字は折り返さない） */
export const APP_NAME_MAX = 100;

export const IMAGE_FORMAT_POLICIES = ["keep", "png", "jpeg"] as const;
export type ImageFormatPolicy = (typeof IMAGE_FORMAT_POLICIES)[number];
export const IMAGE_MAX_EDGE_MIN = 200;
export const IMAGE_MAX_EDGE_MAX = 8000;

export const DEFAULT_SETTINGS: AppSettings = {
  maintenanceMode: false,
  casRequired: false,
  casFormatEnforced: false,
  compositionValidationMode: "STANDARD",
  conditionalLinkMode: "review",
  compositionEpsilonPct: "0.001",
  productModelOptions: [],
  productUseOptions: [],
  categoryScoreMin: "0",
  categoryScoreMax: "100",
  substanceApprovalRequired: false,
  productApprovalRequired: false,
  sessionIdleMinutes: 10,
  passwordExpiryDays: 0,
  passwordExpiryWarnDays: 0,
  passwordMinLength: 12,
  passwordRequireLetter: true,
  passwordRequireDigit: true,
  passwordRequireSymbol: false,
  passwordSymbolChars: "!@#$%^&*()-_=+[]{};:,.?/",
  passwordRequireMixedCase: false,
  mfaRequired: false,
  documentOutputDir: DEFAULT_DOC_OUTPUT_DIR,
  documentFileNamePattern: DEFAULT_DOC_FILE_NAME_PATTERN,
  imageMaxEdgePx: 2000,
  imageFormat: "keep",
  imageJpegQuality: 85,
  appNameJa: "",
  appNameEn: "",
  headerIconVersion: "",
  headerIconPosition: "left",
};

/**
 * その言語で出すシステムの名前。設定が空なら辞書の名前（fallback）
 */
export function appNameOf(
  settings: Pick<AppSettings, "appNameJa" | "appNameEn">,
  locale: string,
  fallback: string,
): string {
  const v = locale === "en" ? settings.appNameEn : settings.appNameJa;
  return v.trim() !== "" ? v.trim() : fallback;
}

/**
 * 文言一式の `common.appName` を設定の名前に差し替える。
 * 題字・ログイン画面・タブの名前は全部この 1 か所を見ているので、ここで替えれば揃う
 */
export function withAppName(m: Messages, settings: AppSettings, locale: string): Messages {
  const name = appNameOf(settings, locale, m.common.appName);
  if (name === m.common.appName) return m;
  return { ...m, common: { ...m.common, appName: name } };
}

/** パスワードの決まりだけを取り出したもの。画面にも渡すのでこの形で持つ */
export type PasswordPolicy = Pick<
  AppSettings,
  | "passwordMinLength"
  | "passwordRequireLetter"
  | "passwordRequireDigit"
  | "passwordRequireSymbol"
  | "passwordSymbolChars"
  | "passwordRequireMixedCase"
>;

/** 決まりのうち、短くしすぎると総当たりに耐えられない下限 */
/**
 * 自動ログアウトまでの分数の範囲。
 * 短すぎると入力の途中で切れ、長すぎると席を離れた端末が開いたままになる。
 */
export const SESSION_IDLE_MIN = 1;
export const SESSION_IDLE_MAX = 480;

export const PASSWORD_MIN_LENGTH_FLOOR = 8;
export const PASSWORD_MAX_LENGTH_CEILING = 128;

/** パスワードの有効期限（日）の上限。0 は「期限なし」 */
export const PASSWORD_EXPIRY_DAYS_MAX = 3650;

/** 期限前に知らせる日数の上限。0 は「知らせない」 */
export const PASSWORD_EXPIRY_WARN_DAYS_MAX = 365;

export const pickPasswordPolicy = (s: AppSettings): PasswordPolicy => ({
  passwordMinLength: s.passwordMinLength,
  passwordRequireLetter: s.passwordRequireLetter,
  passwordRequireDigit: s.passwordRequireDigit,
  passwordRequireSymbol: s.passwordRequireSymbol,
  passwordSymbolChars: s.passwordSymbolChars,
  passwordRequireMixedCase: s.passwordRequireMixedCase,
});

/** 選択肢の一覧は1行1件で持つ。空行と前後の空白は捨て、重複は先に出たものを残す */
export function parseOptionList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const v = line.trim();
    if (v === "" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export const formatOptionList = (values: string[]): string => values.join("\n");

/**
 * DB のキーと AppSettings の対応（値のハードコードを避けるため一元管理する）。
 * DB には文字列で入るので、読み書きの変換もここに持たせる。
 */
interface SettingDef<K extends keyof AppSettings = keyof AppSettings> {
  field: K;
  key: string;
  valueType: "BOOLEAN" | "STRING" | "NUMBER";
  /** DB の文字列 → 設定値。読めない値は既定にフォールバックさせるため null を返す */
  parse: (raw: string) => AppSettings[K] | null;
  /** 設定値 → DB の文字列。既定は String()。一覧のように単純変換できないものだけ指定する */
  format?: (value: AppSettings[K]) => string;
}

const boolDef = (field: keyof AppSettings, key: string): SettingDef => ({
  field,
  key,
  valueType: "BOOLEAN",
  parse: (raw) => (raw === "true" || raw === "false" ? raw === "true" : null),
});

export const SETTING_DEFS: SettingDef[] = [
  boolDef("maintenanceMode", "system.maintenance_mode"),
  boolDef("casRequired", "substance.cas_required"),
  boolDef("casFormatEnforced", "substance.cas_format_enforced"),
  {
    field: "compositionValidationMode",
    key: "composition.validation_mode",
    valueType: "STRING",
    parse: (raw) =>
      (COMPOSITION_VALIDATION_MODES as readonly string[]).includes(raw)
        ? (raw as CompositionValidationMode)
        : null,
  },
  {
    field: "conditionalLinkMode",
    key: "judgment.conditional_link_mode",
    valueType: "STRING",
    parse: (raw) =>
      (CONDITIONAL_LINK_MODES as readonly string[]).includes(raw)
        ? (raw as ConditionalLinkMode)
        : null,
  },
  {
    field: "compositionEpsilonPct",
    key: "composition.epsilon_pct",
    valueType: "NUMBER",
    parse: (raw) => {
      const scaled = toScaled(raw);
      return scaled !== null && scaled >= 0n ? raw.trim() : null;
    },
  },
  {
    field: "categoryScoreMin",
    key: "score.category_min",
    valueType: "NUMBER",
    parse: (raw) => (toScaled(raw) !== null ? raw.trim() : null),
  },
  {
    field: "categoryScoreMax",
    key: "score.category_max",
    valueType: "NUMBER",
    parse: (raw) => (toScaled(raw) !== null ? raw.trim() : null),
  },
  boolDef("substanceApprovalRequired", "substance.approval_required"),
  boolDef("productApprovalRequired", "product.approval_required"),
  {
    field: "passwordMinLength",
    key: "password.min_length",
    valueType: "NUMBER",
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isInteger(n)) return null;
      return n >= PASSWORD_MIN_LENGTH_FLOOR && n <= PASSWORD_MAX_LENGTH_CEILING ? n : null;
    },
  },
  {
    field: "passwordExpiryDays",
    key: "password.expiry_days",
    valueType: "NUMBER",
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isInteger(n)) return null;
      return n >= 0 && n <= PASSWORD_EXPIRY_DAYS_MAX ? n : null;
    },
  },
  {
    field: "passwordExpiryWarnDays",
    key: "password.expiry_warn_days",
    valueType: "NUMBER",
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isInteger(n)) return null;
      return n >= 0 && n <= PASSWORD_EXPIRY_WARN_DAYS_MAX ? n : null;
    },
  },
  {
    field: "sessionIdleMinutes",
    key: "session.idle_minutes",
    valueType: "NUMBER",
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isInteger(n)) return null;
      return n >= SESSION_IDLE_MIN && n <= SESSION_IDLE_MAX ? n : null;
    },
  },
  boolDef("mfaRequired", "mfa.required"),
  boolDef("passwordRequireLetter", "password.require_letter"),
  boolDef("passwordRequireDigit", "password.require_digit"),
  boolDef("passwordRequireSymbol", "password.require_symbol"),
  {
    field: "passwordSymbolChars",
    key: "password.symbol_chars",
    valueType: "STRING",
    // 空も正しい設定（そのときは英数字と空白以外すべてを記号とみなす）
    parse: (raw) => raw,
  },
  boolDef("passwordRequireMixedCase", "password.require_mixed_case"),
  {
    field: "productModelOptions",
    key: "product.model_options",
    valueType: "STRING",
    parse: (raw) => parseOptionList(raw),
    format: (v) => formatOptionList(v as string[]),
  },
  {
    field: "productUseOptions",
    key: "product.use_options",
    valueType: "STRING",
    parse: (raw) => parseOptionList(raw),
    format: (v) => formatOptionList(v as string[]),
  },
  {
    field: "documentOutputDir",
    key: "document.output_dir",
    valueType: "STRING",
    parse: (raw) => (raw.trim() === "" ? null : raw.trim()),
  },
  {
    field: "imageMaxEdgePx",
    key: "image.max_edge_px",
    valueType: "NUMBER",
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isInteger(n)) return null;
      return n >= IMAGE_MAX_EDGE_MIN && n <= IMAGE_MAX_EDGE_MAX ? n : null;
    },
  },
  {
    field: "imageFormat",
    key: "image.format",
    valueType: "STRING",
    parse: (raw) =>
      (IMAGE_FORMAT_POLICIES as readonly string[]).includes(raw)
        ? (raw as ImageFormatPolicy)
        : null,
  },
  {
    field: "imageJpegQuality",
    key: "image.jpeg_quality",
    valueType: "NUMBER",
    parse: (raw) => {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
    },
  },
  {
    field: "documentFileNamePattern",
    key: "document.file_name_pattern",
    valueType: "STRING",
    // 知らない差込みが入っていれば既定に戻す（作れないファイル名にしない）
    parse: (raw) =>
      raw.trim() !== "" && unknownFileNamePlaceholders(raw).length === 0 ? raw.trim() : null,
  },
  // 空は「既定の名前」なので、そのまま通す
  { field: "appNameJa", key: "ui.app_name_ja", valueType: "STRING", parse: (raw) => raw },
  { field: "appNameEn", key: "ui.app_name_en", valueType: "STRING", parse: (raw) => raw },
  {
    field: "headerIconVersion",
    key: "ui.header_icon_version",
    valueType: "STRING",
    parse: (raw) => raw,
  },
  {
    field: "headerIconPosition",
    key: "ui.header_icon_position",
    valueType: "STRING",
    parse: (raw) =>
      (HEADER_ICON_POSITIONS as readonly string[]).includes(raw)
        ? (raw as HeaderIconPosition)
        : null,
  },
];

/** 許容誤差は 0〜10%。これより大きい値は設定ミスとみなす */
const epsilonSchema = (m: Messages) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, m.validation.numberFormat)
    .refine((v) => {
      const scaled = toScaled(v);
      return scaled !== null && scaled <= 10n * 1000000n;
    }, m.settings.epsilonRange);

/** スコアの範囲の端。小数3桁まで。負の値も許す（人が決める点数なので） */
const scoreBoundSchema = (m: Messages) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,3})?$/, m.validation.numberFormat);

export const settingsSchema = (m: Messages) =>
  z.object({
    maintenanceMode: z.boolean(),
    casRequired: z.boolean(),
    casFormatEnforced: z.boolean(),
    compositionValidationMode: z.enum(COMPOSITION_VALIDATION_MODES),
    conditionalLinkMode: z.enum(CONDITIONAL_LINK_MODES),
    compositionEpsilonPct: epsilonSchema(m),
    // 1件あたり100文字・全体で200件まで。桁外れの入力で画面が壊れないようにする
    productModelOptions: z.array(z.string().trim().min(1).max(100)).max(200),
    productUseOptions: z.array(z.string().trim().min(1).max(100)).max(200),
    categoryScoreMin: scoreBoundSchema(m),
    categoryScoreMax: scoreBoundSchema(m),
    substanceApprovalRequired: z.boolean(),
    productApprovalRequired: z.boolean(),
    passwordMinLength: z
      .number()
      .int()
      .min(PASSWORD_MIN_LENGTH_FLOOR, m.settings.passwordMinLengthRange)
      .max(PASSWORD_MAX_LENGTH_CEILING, m.settings.passwordMinLengthRange),
    sessionIdleMinutes: z
      .number()
      .int()
      .min(SESSION_IDLE_MIN, m.settings.sessionIdleRange)
      .max(SESSION_IDLE_MAX, m.settings.sessionIdleRange),
    passwordExpiryDays: z
      .number()
      .int()
      .min(0, m.settings.passwordExpiryRange)
      .max(PASSWORD_EXPIRY_DAYS_MAX, m.settings.passwordExpiryRange),
    passwordExpiryWarnDays: z
      .number()
      .int()
      .min(0, m.settings.passwordExpiryWarnRange)
      .max(PASSWORD_EXPIRY_WARN_DAYS_MAX, m.settings.passwordExpiryWarnRange),
    passwordRequireLetter: z.boolean(),
    passwordRequireDigit: z.boolean(),
    passwordRequireSymbol: z.boolean(),
    passwordSymbolChars: z.string().max(100),
    passwordRequireMixedCase: z.boolean(),
    mfaRequired: z.boolean(),
    // フォルダーがあるか・書けるかは、サーバー側（API）で確かめる
    documentOutputDir: z
      .string()
      .trim()
      .min(1, m.validation.required)
      .max(500, m.validation.tooLong(500)),
    documentFileNamePattern: z
      .string()
      .trim()
      .min(1, m.validation.required)
      .max(200, m.validation.tooLong(200))
      .refine(
        (v) => unknownFileNamePlaceholders(v).length === 0,
        (v) => ({ message: m.settings.fileNamePatternUnknown(unknownFileNamePlaceholders(v)) }),
      ),
    imageMaxEdgePx: z
      .number()
      .int()
      .min(IMAGE_MAX_EDGE_MIN, m.settings.imageMaxEdgeRange)
      .max(IMAGE_MAX_EDGE_MAX, m.settings.imageMaxEdgeRange),
    imageFormat: z.enum(IMAGE_FORMAT_POLICIES),
    imageJpegQuality: z
      .number()
      .int()
      .min(1, m.settings.imageJpegQualityRange)
      .max(100, m.settings.imageJpegQualityRange),
    appNameJa: z.string().trim().max(APP_NAME_MAX, m.validation.tooLong(APP_NAME_MAX)),
    appNameEn: z.string().trim().max(APP_NAME_MAX, m.validation.tooLong(APP_NAME_MAX)),
    headerIconPosition: z.enum(HEADER_ICON_POSITIONS),
    // headerIconVersion はアイコンを預けた・外したときにサーバーが書く。画面からは受けない
  });

export type SettingsInput = z.infer<ReturnType<typeof settingsSchema>>;

/**
 * 承認を「必要 → 不要」に切り替えるとき、承認待のものをどうするか。
 * 承認する人がいなくなるので、宙に浮かせないよう必ずどちらかに寄せる。
 */
export const PENDING_RESOLUTIONS = ["draft", "publish"] as const;
export type PendingResolution = (typeof PENDING_RESOLUTIONS)[number];

/** 設定の保存。承認待が残る切り替えのときだけ、その扱いを添えてもらう */
export const settingsSaveSchema = (m: Messages) =>
  settingsSchema(m).extend({
    pendingResolution: z
      .object({
        substance: z.enum(PENDING_RESOLUTIONS).optional(),
        product: z.enum(PENDING_RESOLUTIONS).optional(),
      })
      .optional(),
  });

export type SettingsSaveInput = z.infer<ReturnType<typeof settingsSaveSchema>>;
