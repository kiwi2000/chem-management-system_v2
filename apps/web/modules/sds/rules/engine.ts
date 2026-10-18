// GHS 判定のルール言語（S27）の実行の仕組み（最小版）。
// 読んだルールセット（generated/ast.ts の木）を、レイヤーの順に重ね合わせ、混合物に当てて区分を出す。
// 式は自前で解釈する（JavaScript の eval は使わない）。
import * as ast from "./generated/ast";

// ---------- 入力（混合物・製品） ----------

export interface Ingredient {
  name: string;
  cas?: string;
  /** 含有率（%）。上限で計算する（S25 の決定 8） */
  conc: number;
  /** クラス → 区分（例: skin → "1A"） */
  categories: Map<string, string>;
  /** 値（例: "ate.oral" → 3000） */
  values: Map<string, number>;
  /** 毒性が未知のクラス。"*" は全部 */
  unknown: Set<string>;
  /** 評価済みで「区分に該当しない」クラス（未知ではない）。省けば空 */
  noHazard?: Set<string>;
  /** 成分の印（relevant・non_additive・no_acute_toxicity など。物質マスタの拡張属性から） */
  flags: Set<string>;
}

export interface Mixture {
  ingredients: Ingredient[];
  /** 製品のプロパティ（拡張属性のキー → 値） */
  product: Map<string, number | string>;
}

// ---------- 結果 ----------

export type Outcome =
  | { kind: "category"; category: string }
  | { kind: "not_classified" }
  | { kind: "unclassifiable" }
  | { kind: "not_applicable" };

export interface ClassResult {
  class: string;
  outcome: Outcome | null;
  /**
   * 結果に添える文と、その置き場所（選択点の値）。
   * `text` はルールセットに書かれた文（`note "…"`）。処理系が足す文は `code` で返し、文言は画面側（モジュールの messages）で付ける
   * （本体の辞書に SDS 版だけの言葉を入れないため）
   */
  notes: ResultNote[];
  /** 人の判断が要る理由 */
  judgement: string[];
  /** そう決めた理由（classify の because） */
  because: string[];
  /** 採らない区分に当たって読み替えたとき */
  remapped?: { from: string; to: Outcome };
  /** 根拠（実行の記録）。classifyClass に trace: true を渡したときだけ */
  trace?: TraceEntry[];
}

/**
 * 根拠の 1 行。文言は持たず、種類と値だけ（画面側が言葉を付ける）。
 * `text` はルールセットに書かれた式や条件そのもの（Langium の木から取る）
 */
export type TraceEntry =
  | { kind: "consider"; ingredient: string; included: boolean; text: string }
  | { kind: "ignore"; ingredient: string; excluded: boolean; text: string }
  | { kind: "flag"; ingredient: string; flag: string }
  | { kind: "assign"; name: string; value: TraceValue; text: string }
  | {
      kind: "assign_per_ingredient";
      name: string;
      text: string;
      values: { ingredient: string; value: TraceValue }[];
    }
  | { kind: "if"; text: string; result: boolean }
  | { kind: "classify"; category: string; because: string | null }
  | { kind: "bands"; value: number; category: string | null; cappedTo: string | null }
  | { kind: "option"; name: string; value: string | null; chosenBy: string | null }
  | { kind: "outcome"; outcome: Outcome };

/** 根拠に載せる値。成分の集合は名前の並びにする */
export type TraceValue = number | string | boolean | null | string[];

export type ResultNote =
  | { text: string; code?: undefined; params?: undefined; place: string | null }
  | {
      text?: undefined;
      code: ResultNoteCode;
      params?: Record<string, string>;
      place: string | null;
    };

/** 処理系が足す文の種類。画面側で文言を付ける */
export type ResultNoteCode =
  | "missing_value" // 計算に必要な値が無いので分類できない
  | "excluded_category" // 国連の式で出た区分をこの国では採らないので読み替えた（params: category, result）
  | "capped_at_ingredient"; // 式で出た区分が最も重い成分の区分より重かったので、その区分に止めた（params: computed, category）

// ---------- 重ね合わせたルールセット ----------

export interface MergedOption {
  name: string;
  label: string;
  values: ast.OptionValue[];
  safest?: ast.OptionValue;
  chosen?: ast.OptionValue;
  lock?: "locked" | "open";
  chosenBy?: string;
}

export interface MergedRule {
  class: string;
  consider?: ast.Expr;
  ignore?: ast.Expr;
  nonAdditive?: ast.Expr;
  bands?: ast.Band[];
  conversion?: { target: string; entries: ast.ConvertEntry[] };
  /** 上のどれでもない文（型の枠・if・代入・classify など）。順に実行する */
  body: ast.Stmt[];
}

export interface Exclusion {
  pattern: string[];
  result: "not_classified" | "unclassifiable";
}

export interface Merged {
  /** レイヤーの名前（土台から順） */
  layers: string[];
  classes: Map<string, ast.ClassDecl>;
  options: Map<string, MergedOption>;
  rules: Map<string, MergedRule>;
  exclusions: Exclusion[];
  /** 自社のレイヤーの flag 文 */
  flags: { flag: string; cond: ast.Expr }[];
  tests: { layer: string; test: ast.TestCase }[];
  /** 検査で見つかった問題（未選択の選択点、locked の選び直しなど） */
  problems: string[];
}

export class RuleError extends Error {}

const key = (r: ast.Ruleset) => `${r.name}@${r.version}`;

/** 土台から順にレイヤーを並べる */
export function chain(top: ast.Ruleset, registry: Map<string, ast.Ruleset>): ast.Ruleset[] {
  const out: ast.Ruleset[] = [];
  let cur: ast.Ruleset | undefined = top;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(key(cur))) throw new RuleError(`レイヤーが循環しています: ${key(cur)}`);
    seen.add(key(cur));
    out.unshift(cur);
    if (!cur.baseName) break;
    const base = registry.get(`${cur.baseName}@${cur.baseVersion}`);
    if (!base)
      throw new RuleError(`土台のルールセットがありません: ${cur.baseName}@${cur.baseVersion}`);
    cur = base;
  }
  return out;
}

const isKindStmt = (s: ast.Stmt) =>
  ast.isRelevantStmt(s) ||
  ast.isIgnoreStmt(s) ||
  ast.isNonAdditiveStmt(s) ||
  ast.isBandsStmt(s) ||
  ast.isConvertStmt(s);

function applyRule(target: MergedRule, def: ast.RuleDef, mode: "base" | "override" | "add") {
  const general: ast.Stmt[] = [];
  for (const s of def.body.stmts) {
    if (ast.isRelevantStmt(s)) target.consider = s.cond;
    else if (ast.isIgnoreStmt(s)) target.ignore = s.cond;
    else if (ast.isNonAdditiveStmt(s)) target.nonAdditive = s.cond;
    else if (ast.isBandsStmt(s)) target.bands = s.bands;
    else if (ast.isConvertStmt(s)) target.conversion = { target: s.target, entries: s.entries };
    else general.push(s);
  }
  if (mode === "add") target.body = [...target.body, ...general];
  else if (general.length > 0 || mode === "base") target.body = general;
  void isKindStmt;
}

/** レイヤーを重ね合わせる。問題は problems に集め、致命的なものだけ例外にする */
export function merge(top: ast.Ruleset, registry: Map<string, ast.Ruleset>): Merged {
  const layers = chain(top, registry);
  const m: Merged = {
    layers: layers.map(key),
    classes: new Map(),
    options: new Map(),
    rules: new Map(),
    exclusions: [],
    flags: [],
    tests: [],
    problems: [],
  };
  for (const layer of layers) {
    const name = key(layer);
    const isBase = !layer.baseName;
    const sections = layer.sections;
    for (const sec of sections) {
      if (ast.isClassesBlock(sec)) {
        for (const c of sec.classes) m.classes.set(c.name, c);
      } else if (ast.isOptionsBlock(sec)) {
        for (const o of sec.options) declareOption(m, o);
      } else if (ast.isLabelsBlock(sec)) {
        for (const e of sec.entries) if (ast.isOptionDecl(e)) declareOption(m, e);
      } else if (ast.isRulesBlock(sec)) {
        for (const r of sec.rules) mergeRule(m, r, isBase ? "base" : (r.mode ?? "override"));
      } else if (ast.isRuleDef(sec)) {
        mergeRule(m, sec, isBase ? "base" : (sec.mode ?? "override"));
      } else if (ast.isExcludeStmt(sec)) {
        m.exclusions.push({
          pattern: sec.target.split("."),
          result: (sec.result as Exclusion["result"]) ?? "not_classified",
        });
      } else if (ast.isChooseStmt(sec)) {
        choose(m, sec, name);
      } else if (ast.isFlagStmt(sec)) {
        m.flags.push({ flag: sec.flag, cond: sec.cond });
      } else if (ast.isTestsBlock(sec)) {
        for (const t of sec.tests) m.tests.push({ layer: name, test: t });
      }
      // meta・sds・adopt・defaults は最小版では読むだけ
    }
  }
  // 未選択の選択点: 土台だけ（国連のレイヤーをそのまま使う）なら安全側の既定、国・自社のレイヤーが上にあれば問題にする
  for (const o of m.options.values()) {
    if (!o.chosen) {
      if (layers.length === 1 && o.safest) {
        o.chosen = resolveOptionValue(o, o.safest);
        o.chosenBy = "safest";
      } else if (layers.length > 1) m.problems.push(`選択点が未選択です: ${o.name}`);
    }
  }
  return m;
}

function declareOption(m: Merged, o: ast.OptionDecl) {
  m.options.set(o.name, { name: o.name, label: o.label, values: o.values, safest: o.safest });
}

function choose(m: Merged, c: ast.ChooseStmt, layer: string) {
  const o = m.options.get(c.option);
  if (!o) {
    m.problems.push(`知らない選択点です: ${c.option}（${layer}）`);
    return;
  }
  if (o.lock === "locked") {
    m.problems.push(
      `選択点 ${c.option} は ${o.chosenBy} が locked にしているので選び直せません（${layer}）`,
    );
    return;
  }
  if (!o.values.some((v) => v.name === c.value.name)) {
    m.problems.push(`選択点 ${c.option} に無い値です: ${c.value.name}（${layer}）`);
    return;
  }
  o.chosen = resolveOptionValue(o, c.value);
  o.chosenBy = layer;
  if (c.lock) o.lock = c.lock;
}

/** 選んだ値に引数が無ければ、宣言した値の引数（low(0.1 %) など）を使う */
function resolveOptionValue(o: MergedOption, v: ast.OptionValue): ast.OptionValue {
  if (v.arg) return v;
  return o.values.find((d) => d.name === v.name) ?? v;
}

function mergeRule(m: Merged, def: ast.RuleDef, mode: "base" | "override" | "add") {
  let r = m.rules.get(def.class);
  if (!r) {
    r = { class: def.class, body: [] };
    m.rules.set(def.class, r);
    mode = "base";
  }
  applyRule(r, def, mode);
}

// ---------- 式の解釈 ----------

type Value = number | string | boolean | null | Value[] | Ingredient[];

interface Env {
  merged: Merged;
  rule: MergedRule;
  mixture: Mixture;
  /** 考慮すべき成分（consider / ignore を当てたあと） */
  relevant: Ingredient[];
  /** 名前の付いた値。式のまま持ち、使う場所の文脈（成分の中か外か）で評価する */
  bindings: Map<string, ast.Expr | Value>;
  /** いま見ている成分（sum の中など）。無ければ null */
  ingredient: Ingredient | null;
  /** 評価の回数の上限（無限の繰り返しを防ぐ） */
  budget: { n: number };
  /** 根拠の記録先。無ければ記録しない */
  trace?: TraceEntry[];
  /** 読んだ選択点（根拠に 1 回だけ載せるため） */
  tracedOptions?: Set<string>;
}

/** 成分ごとの式を成分の外で評価したときの印（根拠の記録で「成分ごとの値」に切り替えるため） */
class NeedsIngredientError extends RuleError {}

/** 木の文字列（ルールセットに書かれた式そのもの）。無ければ型の名前 */
function textOf(node: ast.Expr | ast.Stmt): string {
  return node.$cstNode?.text.replace(/\s+/g, " ").trim() ?? node.$type;
}

function toTraceValue(v: Value): TraceValue {
  if (isIngredients(v)) return v.map((i) => i.name);
  if (Array.isArray(v)) return (v as Value[]).map((x) => String(x));
  if (typeof v === "number") return Number.isFinite(v) ? Number(v.toFixed(6)) : null;
  return v;
}

const isExprNode = (v: unknown): v is ast.Expr =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "$type" in v;
const isIngredients = (v: Value): v is Ingredient[] =>
  Array.isArray(v) && (v.length === 0 || typeof v[0] === "object");

function num(v: Value, what: string): number {
  if (typeof v === "number") return v;
  if (v === null) return NaN;
  // 区分の "2" のような数字の文字列は数値として扱う（最も重い区分を min で選ぶため）
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  throw new RuleError(`${what} は数値ではありません: ${String(v)}`);
}

function same(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a) === String(b);
}

function evalExpr(e: ast.Expr, env: Env): Value {
  if (++env.budget.n > 200000) throw new RuleError("式の評価が多すぎます（無限の繰り返し？）");
  if (ast.isNumberLit(e)) return e.value;
  if (ast.isStringLit(e)) return e.value;
  if (ast.isBoolLit(e)) return e.value === "true";
  if (ast.isListExpr(e)) return e.items.map((i) => evalExpr(i, env));
  if (ast.isSetExpr(e))
    return e.kind === "all_ingredients" ? env.mixture.ingredients : env.relevant;
  if (ast.isWhereExpr(e)) {
    const set = evalExpr(e.set, env);
    if (!isIngredients(set)) throw new RuleError("where の左は成分の集合ではありません");
    return set.filter((ing) => truthy(evalExpr(e.cond, { ...env, ingredient: ing })));
  }
  if (ast.isAggregateExpr(e)) return aggregate(e, env);
  if (ast.isCallExpr(e)) return call(e, env);
  if (ast.isRefExpr(e)) return ref(e.ref, env);
  if (ast.isIfExpr(e))
    return truthy(evalExpr(e.cond, env)) ? evalExpr(e.then, env) : evalExpr(e.else, env);
  if (ast.isBetweenExpr(e)) {
    const v = num(evalExpr(e.value, env), "between の値");
    return (
      v >= num(evalExpr(e.low, env), "between の下") &&
      v <= num(evalExpr(e.high, env), "between の上")
    );
  }
  if (ast.isUnaryExpr(e)) {
    const v = evalExpr(e.operand, env);
    return e.op === "not" ? !truthy(v) : -num(v, "符号");
  }
  if (ast.isBinaryExpr(e)) return binary(e, env);
  throw new RuleError(`読めない式です: ${(e as ast.Expr).$type}`);
}

function truthy(v: Value): boolean {
  if (v === null) return false;
  if (typeof v === "number") return !Number.isNaN(v) && v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function binary(e: ast.BinaryExpr, env: Env): Value {
  if (e.op === "and") return truthy(evalExpr(e.left, env)) && truthy(evalExpr(e.right, env));
  if (e.op === "or") return truthy(evalExpr(e.left, env)) || truthy(evalExpr(e.right, env));
  const l = evalExpr(e.left, env);
  const r = evalExpr(e.right, env);
  switch (e.op) {
    case "==":
      return same(l, r);
    case "!=":
      return !same(l, r);
    case "in":
      if (!Array.isArray(r)) throw new RuleError("in の右は一覧ではありません");
      return (r as Value[]).some((x) => same(l, x));
    case "<":
      return num(l, "比較") < num(r, "比較");
    case "<=":
      return num(l, "比較") <= num(r, "比較");
    case ">":
      return num(l, "比較") > num(r, "比較");
    case ">=":
      return num(l, "比較") >= num(r, "比較");
    case "+":
      return num(l, "加算") + num(r, "加算");
    case "-":
      return num(l, "減算") - num(r, "減算");
    case "*":
      return num(l, "乗算") * num(r, "乗算");
    case "/": {
      const d = num(r, "除算");
      return d === 0 ? NaN : num(l, "除算") / d;
    }
  }
  throw new RuleError(`知らない演算子: ${e.op}`);
}

function aggregate(e: ast.AggregateExpr, env: Env): Value {
  const setExpr = e.set ?? e.first;
  const body = e.set ? e.first : null;
  const set = evalExpr(setExpr, env);
  if (!isIngredients(set)) throw new RuleError(`${e.fn} の対象が成分の集合ではありません`);
  const vals = set.map((ing) => (body ? evalExpr(body, { ...env, ingredient: ing }) : 1));
  switch (e.fn) {
    case "count":
      return set.length;
    case "any":
      return set.length > 0;
    case "sum":
      return vals.reduce<number>((a, v) => a + (v === null ? 0 : num(v, "sum")), 0);
    case "max":
      return vals.length ? Math.max(...vals.map((v) => num(v, "max"))) : null;
    case "min":
      return vals.length ? Math.min(...vals.map((v) => num(v, "min"))) : null;
  }
  throw new RuleError(`知らない集計: ${e.fn}`);
}

function needIngredient(env: Env, what: string): Ingredient {
  if (!env.ingredient)
    throw new NeedsIngredientError(
      `${what} は成分ごとの式の中（sum(… of …) や where）でしか使えません`,
    );
  return env.ingredient;
}

function call(e: ast.CallExpr, env: Env): Value {
  const args = e.args;
  const refName = (i: number) => {
    const a = args[i];
    if (a && ast.isRefExpr(a)) return a.ref;
    if (a && ast.isStringLit(a)) return a.value;
    throw new RuleError(`${e.fn} の引数は名前でなければなりません`);
  };
  switch (e.fn) {
    case "flagged":
      return needIngredient(env, "flagged").flags.has(refName(0));
    case "unknown": {
      const ing = needIngredient(env, "unknown");
      return ing.unknown.has("*") || (args.length > 0 && ing.unknown.has(refName(0)));
    }
    case "no_hazard": {
      // 評価済みで「区分に該当しない」。未知と区別する（加算式で未知に数えない）
      const ing = needIngredient(env, "no_hazard");
      return ing.noHazard?.has(refName(0)) ?? false;
    }
    case "category": {
      const ing = needIngredient(env, "category");
      return ing.categories.get(refName(0)) ?? null;
    }
    case "ate": {
      const ing = needIngredient(env, "ate");
      return ing.values.get(`ate.${refName(0)}`) ?? null;
    }
    case "value": {
      // 成分の値（物質の拡張属性のキーそのまま。m_factor_acute、noec_chronic など）
      const ing = needIngredient(env, "value");
      return ing.values.get(refName(0)) ?? null;
    }
    case "has_flag": {
      // 混合物のどれかの成分に印があるか（成分の外でも使える）
      return env.mixture.ingredients.some((ing) => ing.flags.has(refName(0)));
    }
    case "convert": {
      const v = evalExpr(args[0]!, env);
      const table = env.rule.conversion;
      if (!table || v === null) return null;
      const hit = table.entries.find((en) => same(en.category, v));
      return hit ? hit.value.value : null;
    }
    case "band": {
      // 値をこの決まりの帯に当てた区分（成分の実測 ATE から区分を出すときに使う）。帯に無ければ null
      const v = evalExpr(args[0]!, env);
      if (v === null || (typeof v === "number" && !Number.isFinite(v))) return null;
      const inner: Env = { ...env, bindings: new Map(env.bindings) };
      inner.bindings.set("ate", v);
      inner.bindings.set("value", v);
      for (const b of env.rule.bands ?? []) {
        if (truthy(evalExpr(b.cond, inner))) return String(b.category);
      }
      return null;
    }
    case "coalesce":
      for (const a of args) {
        const v = evalExpr(a, env);
        if (v !== null && !(typeof v === "number" && Number.isNaN(v))) return v;
      }
      return null;
    case "has_value": {
      const v = evalExpr(args[0]!, env);
      return v !== null && !(typeof v === "number" && Number.isNaN(v));
    }
    case "option": {
      const o = env.merged.options.get(refName(0));
      if (!o) throw new RuleError(`知らない選択点です: ${refName(0)}`);
      if (env.trace && env.tracedOptions && !env.tracedOptions.has(o.name)) {
        env.tracedOptions.add(o.name);
        env.trace.push({
          kind: "option",
          name: o.name,
          value: o.chosen?.name ?? null,
          chosenBy: o.chosenBy ?? null,
        });
      }
      return o.chosen?.name ?? null;
    }
    case "option_arg": {
      const o = env.merged.options.get(refName(0));
      return o?.chosen?.arg?.value ?? null;
    }
  }
  throw new RuleError(`知らない関数です: ${e.fn}`);
}

function ref(name: string, env: Env): Value {
  const parts = name.split(".");
  if (parts[0] === "product") {
    const v = env.mixture.product.get(parts.slice(1).join("."));
    return v ?? null;
  }
  if (env.ingredient && parts.length === 1) {
    const ing = env.ingredient;
    if (name === "conc") return ing.conc;
    if (name === "cas") return ing.cas ?? null;
    if (name === "name") return ing.name;
  }
  const b = env.bindings.get(name);
  if (b !== undefined) {
    if (isExprNode(b)) return evalExpr(b, env);
    return b as Value;
  }
  // 知らない名前は記号（区分 "1A"、選択点の値 "split" など）
  return name;
}

// ---------- 文の実行 ----------

interface RunState {
  result: ClassResult;
  bands?: ast.Band[];
}

/**
 * 代入の値を根拠に載せる。成分の外で評価できる式はその値、成分ごとの式（ate_of など）は考慮する成分ごとの値。
 * 評価できない（データ不足など）ときは null
 */
function traceAssign(s: ast.AssignStmt, env: Env) {
  const text = textOf(s.value);
  const safe = (e: Env): Value | undefined => {
    const saved = env.trace;
    env.trace = undefined; // 記録のための評価では、条件や選択点を二重に記録しない
    try {
      return evalExpr(s.value, e);
    } catch (err) {
      if (err instanceof NeedsIngredientError) return undefined;
      return null;
    } finally {
      env.trace = saved;
    }
  };
  const v = safe(env);
  if (v !== undefined) {
    env.trace!.push({ kind: "assign", name: s.name, value: toTraceValue(v), text });
    return;
  }
  env.trace!.push({
    kind: "assign_per_ingredient",
    name: s.name,
    text,
    values: env.relevant.map((ing) => ({
      ingredient: ing.name,
      value: toTraceValue(safe({ ...env, ingredient: ing }) ?? null),
    })),
  });
}

function run(stmts: ast.Stmt[], env: Env, st: RunState) {
  for (const s of stmts) {
    // 「この製品には当てはまらない」が決まったら、残りの文（note など）は実行しない
    if (st.result.outcome?.kind === "not_applicable") return;
    exec(s, env, st);
  }
}

function exec(s: ast.Stmt, env: Env, st: RunState) {
  if (ast.isBlock(s)) return run(s.stmts, env, st);
  if (ast.isTypedBlock(s)) return run(s.body.stmts, env, st);
  if (ast.isAssignStmt(s)) {
    env.bindings.set(s.name, s.value);
    if (env.trace) traceAssign(s, env);
    return;
  }
  if (ast.isIfStmt(s)) {
    const hit = truthy(evalExpr(s.cond, env));
    env.trace?.push({ kind: "if", text: textOf(s.cond), result: hit });
    if (hit) exec(s.then, env, st);
    else if (s.else) exec(s.else, env, st);
    return;
  }
  if (ast.isClassifyStmt(s)) {
    if (st.result.outcome) return; // 先に決まった結果が勝つ
    const cat = evalExpr(s.category, env);
    st.result.outcome = { kind: "category", category: String(cat) };
    if (s.because) st.result.because.push(s.because);
    env.trace?.push({ kind: "classify", category: String(cat), because: s.because ?? null });
    return;
  }
  if (ast.isClassifyByBandsStmt(s)) {
    if (st.result.outcome) return;
    const v = evalExpr(s.value, env);
    if (v === null || (typeof v === "number" && !Number.isFinite(v))) {
      st.result.outcome = { kind: "unclassifiable" };
      st.result.notes.push({ code: "missing_value", place: null });
      return;
    }
    const bands = env.rule.bands ?? [];
    const inner: Env = { ...env, bindings: new Map(env.bindings) };
    inner.bindings.set("ate", v);
    inner.bindings.set("value", v);
    // 上限の区分（最も重い成分の区分）。帯の並びは重い方が先なので、その位置より前の帯は上限に止める
    let capIndex = -1;
    if (s.cap) {
      const capValue = evalExpr(s.cap, env);
      if (capValue !== null && !(typeof capValue === "number" && !Number.isFinite(capValue))) {
        capIndex = bands.findIndex((b) => same(String(b.category), String(capValue)));
      }
    }
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i]!;
      if (truthy(evalExpr(b.cond, inner))) {
        const pick = capIndex > i ? bands[capIndex]! : b;
        env.trace?.push({
          kind: "bands",
          value: num(v, "bands"),
          category: String(b.category),
          cappedTo: pick !== b ? String(pick.category) : null,
        });
        if (pick !== b) {
          st.result.notes.push({
            code: "capped_at_ingredient",
            params: { computed: String(b.category), category: String(pick.category) },
            place: null,
          });
        }
        st.result.outcome = { kind: "category", category: String(pick.category) };
        return;
      }
    }
    env.trace?.push({ kind: "bands", value: num(v, "bands"), category: null, cappedTo: null });
    st.result.outcome = { kind: "not_classified" };
    return;
  }
  if (ast.isNotClassifiedStmt(s)) {
    if (!st.result.outcome) st.result.outcome = { kind: "not_classified" };
    return;
  }
  if (ast.isNotApplicableStmt(s)) {
    if (!st.result.outcome) st.result.outcome = { kind: "not_applicable" };
    return;
  }
  if (ast.isUnclassifiableStmt(s)) {
    if (!st.result.outcome) st.result.outcome = { kind: "unclassifiable" };
    return;
  }
  if (ast.isNeedsJudgementStmt(s)) {
    st.result.judgement.push(s.reason);
    return;
  }
  if (ast.isNoteStmt(s)) {
    const text = s.text.replace(/\{([^}]+)\}/g, (_m, inner: string) =>
      formatValue(evalInline(inner, env)),
    );
    const place = s.place ? String(evalExpr(s.place, env) ?? "") : null;
    st.result.notes.push({ text, place });
    return;
  }
  // consider / ignore / nonadditive / bands / conversion は merge で取り出し済み
}

/** note の {…} の中は、名前（束縛・成分の集合の合計など）だけを受け付ける簡易な評価 */
function evalInline(src: string, env: Env): Value {
  const m = /^sum\(conc of (\w+)\)$/.exec(src.trim());
  if (m) {
    const set = ref(m[1]!, env);
    if (isIngredients(set)) return set.reduce((a, i) => a + i.conc, 0);
  }
  return ref(src.trim(), env);
}

function formatValue(v: Value): string {
  if (typeof v === "number") return `${Number(v.toFixed(2))} %`;
  return String(v ?? "");
}

// ---------- 判定 ----------

function matchExclusion(pattern: string[], cls: string, category: string): boolean {
  const parts = [...cls.split("."), category];
  if (parts.length !== pattern.length) return false;
  return pattern.every((p, i) => p === "*" || p === parts[i]);
}

/** 1 つのクラスを判定する。`opts.trace` で根拠（実行の記録）を result.trace に付ける */
export function classifyClass(
  merged: Merged,
  cls: string,
  mixture: Mixture,
  opts: { trace?: boolean } = {},
): ClassResult {
  const rule = merged.rules.get(cls);
  const result: ClassResult = { class: cls, outcome: null, notes: [], judgement: [], because: [] };
  if (!rule) return result;
  const trace: TraceEntry[] | undefined = opts.trace ? [] : undefined;
  // 自社のレイヤーの flag を成分に付ける
  const ingredients = mixture.ingredients.map((ing) => ({ ...ing, flags: new Set(ing.flags) }));
  const baseEnv: Env = {
    merged,
    rule,
    mixture: { ...mixture, ingredients },
    relevant: ingredients,
    bindings: new Map(),
    ingredient: null,
    budget: { n: 0 },
    trace,
    tracedOptions: trace ? new Set() : undefined,
  };
  for (const f of merged.flags)
    for (const ing of ingredients)
      if (truthy(evalExpr(f.cond, { ...baseEnv, ingredient: ing }))) {
        ing.flags.add(f.flag);
        trace?.push({ kind: "flag", ingredient: ing.name, flag: f.flag });
      }
  let relevant = ingredients.filter((i) => i.conc > 0);
  if (rule.consider) {
    const cond = rule.consider;
    relevant = relevant.filter((ing) => {
      const included = truthy(evalExpr(cond, { ...baseEnv, ingredient: ing }));
      trace?.push({ kind: "consider", ingredient: ing.name, included, text: textOf(cond) });
      return included;
    });
  }
  if (rule.ignore) {
    const cond = rule.ignore;
    relevant = relevant.filter((ing) => {
      const excluded = truthy(evalExpr(cond, { ...baseEnv, ingredient: ing }));
      if (excluded)
        trace?.push({ kind: "ignore", ingredient: ing.name, excluded, text: textOf(cond) });
      return !excluded;
    });
  }
  const env: Env = { ...baseEnv, relevant };
  if (rule.nonAdditive)
    env.bindings.set(
      "non_additive",
      relevant.filter((ing) => truthy(evalExpr(rule.nonAdditive!, { ...env, ingredient: ing }))),
    );
  else env.bindings.set("non_additive", []);
  run(rule.body, env, { result });
  // 採らない区分の読み替え
  if (result.outcome?.kind === "category") {
    const cat = result.outcome.category;
    const ex = merged.exclusions.find((x) => matchExclusion(x.pattern, cls, cat));
    if (ex) {
      result.remapped = { from: cat, to: { kind: ex.result } };
      result.outcome = { kind: ex.result };
      result.notes.push({
        code: "excluded_category",
        params: { category: cat, result: ex.result },
        place: null,
      });
    }
  }
  if (trace) {
    if (result.outcome) trace.push({ kind: "outcome", outcome: result.outcome });
    result.trace = trace;
  }
  return result;
}

/** 全クラスを判定する */
export function classifyAll(merged: Merged, mixture: Mixture): ClassResult[] {
  return [...merged.rules.keys()].map((cls) => classifyClass(merged, cls, mixture));
}

// ---------- 試験 ----------

export interface TestOutcome {
  layer: string;
  name: string;
  ok: boolean;
  details: string[];
}

export function mixtureFromTest(t: ast.TestCase): Mixture {
  const ingredients: Ingredient[] = t.mixture.items.map((it) => {
    const ing: Ingredient = {
      name: it.name,
      conc: it.conc.value,
      categories: new Map(),
      values: new Map(),
      unknown: new Set(),
      flags: new Set(),
    };
    for (const f of it.facts) {
      if (ast.isUnknownFact(f)) ing.unknown.add(f.class ?? "*");
      else if (ast.isNoHazardFact(f)) (ing.noHazard ??= new Set()).add(f.class);
      else if (ast.isFlagFact(f)) ing.flags.add(f.flag);
      else if (ast.isKeyFact(f)) {
        if (f.value) ing.values.set(f.key, f.value.value);
        else if (f.category) ing.categories.set(f.key, String(f.category));
      }
    }
    return ing;
  });
  const product = new Map<string, number | string>();
  for (const p of t.props?.props ?? []) {
    const v = p.value;
    product.set(p.key, typeof v === "string" ? v : v.value);
  }
  return { ingredients, product };
}

function describe(o: Outcome | null): string {
  if (!o) return "（結果なし）";
  return o.kind === "category" ? o.category : o.kind;
}

/**
 * 各レイヤーに書いた試験を流す。
 * 試験はそのレイヤーを使う形（土台からそのレイヤーまでを重ね合わせたもの）に当てる。
 * 国連のレイヤーの試験は国連だけで、日本のレイヤーの試験は国連＋日本で流す。
 */
export function runTests(top: ast.Ruleset, registry: Map<string, ast.Ruleset>): TestOutcome[] {
  const out: TestOutcome[] = [];
  for (const layer of chain(top, registry)) {
    const merged = merge(layer, registry);
    const own = merged.tests.filter((t) => t.layer === key(layer));
    out.push(...runTestsOn(merged, own));
  }
  return out;
}

function runTestsOn(merged: Merged, tests: Merged["tests"]): TestOutcome[] {
  return tests.map(({ layer, test }) => {
    const mixture = mixtureFromTest(test);
    const details: string[] = [];
    let ok = true;
    for (const ex of test.expect.items) {
      const r = classifyClass(merged, ex.class, mixture);
      const got = describe(r.outcome);
      if (got !== ex.result) {
        ok = false;
        details.push(
          `${ex.class}: 期待 ${ex.result}、結果 ${got}${r.notes.length ? `（${r.notes.map((n) => n.text ?? `${n.code}${n.params ? " " + JSON.stringify(n.params) : ""}`).join("／")}）` : ""}`,
        );
      }
    }
    return { layer, name: test.name, ok, details };
  });
}
