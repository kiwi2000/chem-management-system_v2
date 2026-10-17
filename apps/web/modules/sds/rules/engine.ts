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
  { kind: "category"; category: string } | { kind: "not_classified" } | { kind: "unclassifiable" };

export interface ClassResult {
  class: string;
  outcome: Outcome | null;
  /** 結果に添える文（未知成分の文など）と、その置き場所（選択点の値） */
  notes: { text: string; place: string | null }[];
  /** 人の判断が要る理由 */
  judgement: string[];
  /** そう決めた理由（classify の because） */
  because: string[];
  /** 採らない区分に当たって読み替えたとき */
  remapped?: { from: string; to: Outcome };
}

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
        o.chosen = o.safest;
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
  o.chosen = c.value;
  o.chosenBy = layer;
  if (c.lock) o.lock = c.lock;
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
}

const isExprNode = (v: unknown): v is ast.Expr =>
  typeof v === "object" && v !== null && !Array.isArray(v) && "$type" in v;
const isIngredients = (v: Value): v is Ingredient[] =>
  Array.isArray(v) && (v.length === 0 || typeof v[0] === "object");

function num(v: Value, what: string): number {
  if (typeof v === "number") return v;
  if (v === null) return NaN;
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
    throw new RuleError(`${what} は成分ごとの式の中（sum(… of …) や where）でしか使えません`);
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
    case "category": {
      const ing = needIngredient(env, "category");
      return ing.categories.get(refName(0)) ?? null;
    }
    case "ate": {
      const ing = needIngredient(env, "ate");
      return ing.values.get(`ate.${refName(0)}`) ?? null;
    }
    case "convert": {
      const v = evalExpr(args[0]!, env);
      const table = env.rule.conversion;
      if (!table || v === null) return null;
      const hit = table.entries.find((en) => same(en.category, v));
      return hit ? hit.value.value : null;
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

function run(stmts: ast.Stmt[], env: Env, st: RunState) {
  for (const s of stmts) exec(s, env, st);
}

function exec(s: ast.Stmt, env: Env, st: RunState) {
  if (ast.isBlock(s)) return run(s.stmts, env, st);
  if (ast.isTypedBlock(s)) return run(s.body.stmts, env, st);
  if (ast.isAssignStmt(s)) {
    env.bindings.set(s.name, s.value);
    return;
  }
  if (ast.isIfStmt(s)) {
    if (truthy(evalExpr(s.cond, env))) exec(s.then, env, st);
    else if (s.else) exec(s.else, env, st);
    return;
  }
  if (ast.isClassifyStmt(s)) {
    if (st.result.outcome) return; // 先に決まった結果が勝つ
    const cat = evalExpr(s.category, env);
    st.result.outcome = { kind: "category", category: String(cat) };
    if (s.because) st.result.because.push(s.because);
    return;
  }
  if (ast.isClassifyByBandsStmt(s)) {
    if (st.result.outcome) return;
    const v = evalExpr(s.value, env);
    if (v === null || (typeof v === "number" && !Number.isFinite(v))) {
      st.result.outcome = { kind: "unclassifiable" };
      st.result.notes.push({ text: "計算に必要な値が無いので分類できない", place: null });
      return;
    }
    const bands = env.rule.bands ?? [];
    const inner: Env = { ...env, bindings: new Map(env.bindings) };
    inner.bindings.set("ate", v);
    inner.bindings.set("value", v);
    for (const b of bands) {
      if (truthy(evalExpr(b.cond, inner))) {
        st.result.outcome = { kind: "category", category: String(b.category) };
        return;
      }
    }
    st.result.outcome = { kind: "not_classified" };
    return;
  }
  if (ast.isNotClassifiedStmt(s)) {
    if (!st.result.outcome) st.result.outcome = { kind: "not_classified" };
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

/** 1 つのクラスを判定する */
export function classifyClass(merged: Merged, cls: string, mixture: Mixture): ClassResult {
  const rule = merged.rules.get(cls);
  const result: ClassResult = { class: cls, outcome: null, notes: [], judgement: [], because: [] };
  if (!rule) return result;
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
  };
  for (const f of merged.flags)
    for (const ing of ingredients)
      if (truthy(evalExpr(f.cond, { ...baseEnv, ingredient: ing }))) ing.flags.add(f.flag);
  let relevant = ingredients.filter((i) => i.conc > 0);
  if (rule.consider)
    relevant = relevant.filter((ing) =>
      truthy(evalExpr(rule.consider!, { ...baseEnv, ingredient: ing })),
    );
  if (rule.ignore)
    relevant = relevant.filter(
      (ing) => !truthy(evalExpr(rule.ignore!, { ...baseEnv, ingredient: ing })),
    );
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
        text: `区分 ${cat} はこの国では採用していないため「${ex.result === "not_classified" ? "区分に該当しない" : "分類できない"}」`,
        place: null,
      });
    }
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
          `${ex.class}: 期待 ${ex.result}、結果 ${got}${r.notes.length ? `（${r.notes.map((n) => n.text).join("／")}）` : ""}`,
        );
      }
    }
    return { layer, name: test.name, ok, details };
  });
}
