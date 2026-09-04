import { z } from "zod";
import { COMPOSITION_VALIDATION_MODES, type CompositionValidationMode } from "./composition";
import { toScaled } from "./decimal";
import type { Messages } from "./i18n/ja";

/**
 * システム設定。
 * 値は SystemSetting テーブルに文字列で入れ、ここで型付きに読み替える。
 * 設定を増やすときは AppSettings・DEFAULT_SETTINGS・SETTING_DEFS・settingsSchema の4か所を揃えること。
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
 *  hit    … 条件が無いものとして該非を確定し、警告を出す
 *  review … 要確認にして警告を出す
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
}

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
  passwordMinLength: 12,
  passwordRequireLetter: true,
  passwordRequireDigit: true,
  passwordRequireSymbol: false,
  passwordSymbolChars: "!@#$%^&*()-_=+[]{};:,.?/",
  passwordRequireMixedCase: false,
  mfaRequired: false,
};

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
    passwordRequireLetter: z.boolean(),
    passwordRequireDigit: z.boolean(),
    passwordRequireSymbol: z.boolean(),
    passwordSymbolChars: z.string().max(100),
    passwordRequireMixedCase: z.boolean(),
    mfaRequired: z.boolean(),
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
