import { emptyTableState, normalizeCas, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, type Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getLocale, getServerMessages } from "@/lib/i18n";
import { todayInJapan } from "@/lib/judgement-date";
import { SUBSTANCE_COLUMNS } from "@/lib/list-columns";
import { visibilityWhere } from "@/lib/substance-service";
import { buildOrderBy, buildWhere, type QueryColumn } from "@/lib/table-query";
import { adoptForSubstances, defaultRules } from "./ghs/adopt";
import { CATALOG_BY_CODE } from "./ghs/catalog-data";
import { DEFAULT_COUNTRY, SDS_COUNTRIES } from "./ghs/countries";
import type {
  AdoptionRuleDto,
  GhsDataRowDto,
  GhsSourceRowDto,
  OverrideDto,
  SaveOverridesInput,
  SaveRulesInput,
} from "./ghs/data-dto";
import { SOURCES } from "./ghs/import-service";
import { sdsMessages } from "./messages";

/**
 * GHS データの API（/api/modules/sds/ghs-data…）。
 *
 *   GET ghs-data?…&country=JP   … 物質の一覧（共通の表の状態）＋その国の採用順で採った分類
 *   GET ghs-data/rules?country= … 採用順（保存が無ければ既定）
 *   PUT ghs-data/rules          … 採用順を保存（管理者だけ）
 *   GET ghs-data/overrides?substanceId= … その物質の自社判定
 *   PUT ghs-data/overrides      … その物質 × 効く国 の自社判定を丸ごと置き換える（物質を編集できる人）
 *   GET ghs-data/source?sourceCode=&… … 出典の項目をそのまま（行＝項目。物質マスタに無い CAS も出る）
 */

/** 一覧の絞り込み・並べ替えに使う列（物質の一覧と同じ定義の一部） */
const KEYS = new Set(["code", "casNumber", "nameJa", "nameEn"]);
export const GHS_DATA_COLUMNS = SUBSTANCE_COLUMNS.filter((c) => KEYS.has(c.key));
const DEFAULT_STATE = emptyTableState([{ column: "code", direction: "asc" }]);

/** 出典ごとの表の列（sds_ghs_entries） */
export const GHS_SOURCE_COLUMNS: QueryColumn[] = [
  { key: "sourceKey", kind: "text", field: "sourceKey", caseInsensitive: true },
  { key: "name", kind: "text", field: "name", caseInsensitive: true },
  { key: "nameEn", kind: "text", field: "nameEn", caseInsensitive: true },
  // CAS は子テーブル（1 項目に複数）。値は正規化して完全一致。並べ替えには使えない
  {
    key: "casNumber",
    kind: "list",
    field: "casNormalized",
    normalize: normalizeCas,
    relationPath: ["cas"],
    sortable: false,
  },
  { key: "ecNumber", kind: "text", field: "ecNumber", caseInsensitive: true },
  { key: "conditionText", kind: "text", field: "conditionText", caseInsensitive: true },
  { key: "effectiveFrom", kind: "date", field: "effectiveFrom" },
  { key: "effectiveTo", kind: "date", field: "effectiveTo" },
];
const SOURCE_DEFAULT_STATE = emptyTableState([
  { column: "sourceKey", direction: "asc" },
  { column: "effectiveFrom", direction: "asc" },
]);

function countryOf(req: Request): string {
  const c = new URL(req.url).searchParams.get("country") ?? DEFAULT_COUNTRY;
  return SDS_COUNTRIES.some((x) => x.code === c) ? c : DEFAULT_COUNTRY;
}

export async function ghsDataApi(
  req: Request,
  path: string[],
  actor: Actor,
): Promise<Response | null> {
  const key = `${req.method} ${path.join("/")}`;
  if (key === "GET ghs-data") return list(req, actor);
  if (key === "GET ghs-data/source") return listSource(req, actor);
  if (key === "GET ghs-data/rules") return getRules(req, actor);
  if (key === "PUT ghs-data/rules") return putRules(req, actor);
  if (key === "GET ghs-data/overrides") return getOverrides(req, actor);
  if (key === "PUT ghs-data/overrides") return putOverrides(req, actor);
  return null;
}

async function list(req: Request, actor: Actor): Promise<Response> {
  const m = await getServerMessages();
  if (!actor.has("SUBSTANCE_VIEW")) return jsonError(403, "forbidden", m.errors.forbidden);
  const url = new URL(req.url);
  const state = parseTableState(
    url.searchParams,
    GHS_DATA_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const country = countryOf(req);
  const where = {
    deletedAt: null,
    ...visibilityWhere(actor),
    ...buildWhere(GHS_DATA_COLUMNS, state.filters),
  };
  const [items, total] = await Promise.all([
    prisma.substance.findMany({
      where,
      orderBy: buildOrderBy(GHS_DATA_COLUMNS, state.sort, { codeNormalized: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        code: true,
        nameJa: true,
        nameEn: true,
        casNumber: true,
        casNormalized: true,
      },
    }),
    prisma.substance.count({ where }),
  ]);
  const adopted = await adoptForSubstances(items, country, todayInJapan());
  const rows: GhsDataRowDto[] = items.map((s) => {
    const cells = adopted.get(s.id) ?? [];
    return {
      id: s.id,
      code: s.code,
      nameJa: s.nameJa,
      nameEn: s.nameEn,
      casNumber: s.casNumber,
      hasOverride: cells.some((c) => c.from === "OVERRIDE"),
      cells: Object.fromEntries(
        cells.map((c) => [
          c.hazardClass,
          { status: c.status, items: c.items, from: c.from, reason: c.reason },
        ]),
      ),
    };
  });
  return Response.json({ items: rows, total, page: state.page, pageSize: state.pageSize, country });
}

/** 出典の項目をそのまま。閉じた項目（新しい版に置き換わったもの）も出す（適用終了で絞れる） */
async function listSource(req: Request, actor: Actor): Promise<Response> {
  const m = await getServerMessages();
  if (!actor.has("SUBSTANCE_VIEW")) return jsonError(403, "forbidden", m.errors.forbidden);
  const url = new URL(req.url);
  const sourceCode = url.searchParams.get("sourceCode") ?? "";
  const source = await prisma.sdsGhsSource.findUnique({
    where: { code: sourceCode },
    select: { id: true },
  });
  if (!source) return jsonError(404, "not_found", m.errors.notFound);
  const state = parseTableState(
    url.searchParams,
    GHS_SOURCE_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    SOURCE_DEFAULT_STATE,
  );
  const where = { sourceId: source.id, ...buildWhere(GHS_SOURCE_COLUMNS, state.filters) };
  const [entries, total] = await Promise.all([
    prisma.sdsGhsEntry.findMany({
      where,
      orderBy: buildOrderBy(GHS_SOURCE_COLUMNS, state.sort, { subKey: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        sourceKey: true,
        subKey: true,
        name: true,
        nameEn: true,
        ecNumber: true,
        conditionText: true,
        effectiveFrom: true,
        effectiveTo: true,
        cas: { select: { casNormalized: true, casRaw: true }, orderBy: { ordinal: "asc" } },
        classifications: {
          select: {
            hazardClass: true,
            category: true,
            status: true,
            targetOrgans: true,
            hCodes: true,
            minimumClassification: true,
          },
        },
      },
    }),
    prisma.sdsGhsEntry.count({ where }),
  ]);
  // CAS で結び付く物質（このページの行ぶんだけ。見られる物質だけ）
  const casList = [...new Set(entries.flatMap((e) => e.cas.map((c) => c.casNormalized)))];
  const substances = casList.length
    ? await prisma.substance.findMany({
        where: { casNormalized: { in: casList }, deletedAt: null, ...visibilityWhere(actor) },
        select: { id: true, code: true, casNormalized: true },
        orderBy: { codeNormalized: "asc" },
      })
    : [];
  const byCas = new Map<string, { id: string; code: string }[]>();
  for (const s of substances) {
    if (!s.casNormalized) continue;
    let list = byCas.get(s.casNormalized);
    if (!list) byCas.set(s.casNormalized, (list = []));
    list.push({ id: s.id, code: s.code });
  }
  const items: GhsSourceRowDto[] = entries.map((e) => {
    const cells: GhsSourceRowDto["cells"] = {};
    for (const c of e.classifications) {
      const cell = (cells[c.hazardClass] ??= { status: c.status, items: [] });
      if (c.status === "CLASSIFIED") {
        cell.status = "CLASSIFIED";
        cell.items.push({
          category: c.category,
          targetOrgans: c.targetOrgans,
          hCodes: c.hCodes,
          minimumClassification: c.minimumClassification,
        });
      }
    }
    return {
      id: e.id,
      sourceKey: e.sourceKey,
      subKey: e.subKey,
      name: e.name,
      nameEn: e.nameEn,
      cas: e.cas.map((c) => c.casRaw),
      ecNumber: e.ecNumber,
      conditionText: e.conditionText,
      effectiveFrom: e.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: e.effectiveTo?.toISOString().slice(0, 10) ?? null,
      substances: [
        ...new Map(
          e.cas.flatMap((c) => byCas.get(c.casNormalized) ?? []).map((s) => [s.id, s]),
        ).values(),
      ],
      cells,
    };
  });
  return Response.json({ items, total, page: state.page, pageSize: state.pageSize });
}

async function getRules(req: Request, actor: Actor): Promise<Response> {
  const m = await getServerMessages();
  if (!actor.has("SUBSTANCE_VIEW")) return jsonError(403, "forbidden", m.errors.forbidden);
  const country = countryOf(req);
  const saved = await prisma.sdsGhsAdoptionRule.findMany({
    where: { country },
    orderBy: { priority: "asc" },
  });
  const rules: AdoptionRuleDto[] = (saved.length > 0 ? saved : defaultRules(country)).map((r) => ({
    sourceCode: r.sourceCode,
    priority: r.priority,
    fillCannotClassify: r.fillCannotClassify,
  }));
  return Response.json({
    country,
    saved: saved.length > 0,
    rules,
    sources: SOURCES.map((s) => ({ code: s.code, nameJa: s.nameJa, nameEn: s.nameEn })),
  });
}

async function putRules(req: Request, actor: Actor): Promise<Response> {
  const [m, locale] = await Promise.all([getServerMessages(), getLocale()]);
  if (!actor.has("ADMIN"))
    return jsonError(403, "forbidden", sdsMessages(locale).data.rules.adminOnly);
  let body: SaveRulesInput;
  try {
    body = (await req.json()) as SaveRulesInput;
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const country = SDS_COUNTRIES.some((c) => c.code === body?.country) ? body.country : null;
  const codes = new Set<string>(SOURCES.map((s) => s.code));
  if (
    !country ||
    !Array.isArray(body.rules) ||
    body.rules.some((r) => !codes.has(r.sourceCode)) ||
    new Set(body.rules.map((r) => r.sourceCode)).size !== body.rules.length
  ) {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  await prisma.$transaction(async (tx) => {
    await tx.sdsGhsAdoptionRule.deleteMany({ where: { country } });
    await tx.sdsGhsAdoptionRule.createMany({
      data: body.rules.map((r, i) => ({
        country,
        sourceCode: r.sourceCode,
        priority: i + 1,
        fillCannotClassify: !!r.fillCannotClassify,
      })),
    });
  });
  await writeAudit({
    entity: "sds_ghs_adoption_rule",
    entityId: country,
    action: "update",
    actorId: actor.user.id,
    diff: { country, rules: body.rules },
  });
  return Response.json({ ok: true });
}

async function getOverrides(req: Request, actor: Actor): Promise<Response> {
  const m = await getServerMessages();
  if (!actor.has("SUBSTANCE_VIEW")) return jsonError(403, "forbidden", m.errors.forbidden);
  const substanceId = new URL(req.url).searchParams.get("substanceId") ?? "";
  const rows = await prisma.sdsGhsOverride.findMany({
    where: { substanceId },
    orderBy: [{ country: "asc" }, { hazardClass: "asc" }, { category: "asc" }],
  });
  const items: OverrideDto[] = rows.map((r) => ({
    hazardClass: r.hazardClass,
    category: r.category,
    status: r.status,
    targetOrgans: r.targetOrgans,
    hCodes: r.hCodes,
    country: r.country,
    reason: r.reason,
  }));
  return Response.json({ items });
}

async function putOverrides(req: Request, actor: Actor): Promise<Response> {
  const [m, locale] = await Promise.all([getServerMessages(), getLocale()]);
  const t = sdsMessages(locale).data.edit;
  if (!actor.has("SUBSTANCE_EDIT")) return jsonError(403, "forbidden", m.errors.forbidden);
  let body: SaveOverridesInput;
  try {
    body = (await req.json()) as SaveOverridesInput;
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const substance = await prisma.substance.findFirst({
    where: { id: String(body?.substanceId ?? ""), deletedAt: null, ...visibilityWhere(actor) },
    select: { id: true, code: true },
  });
  if (!substance) return jsonError(404, "not_found", m.errors.notFound);
  const country =
    body.country === "" || SDS_COUNTRIES.some((c) => c.code === body.country) ? body.country : null;
  if (country === null || !Array.isArray(body.items))
    return jsonError(400, "validation_error", m.errors.validation);
  const reason = String(body.reason ?? "").trim();
  if (body.items.length > 0 && !reason) return jsonError(400, "validation_error", t.needReason);
  // 中身を確かめる: クラスはカタログにある、該当なら区分もカタログにある
  const rows: {
    hazardClass: string;
    category: string;
    status: OverrideDto["status"];
    targetOrgans: string | null;
    hCodes: string | null;
  }[] = [];
  for (const it of body.items) {
    const cls = CATALOG_BY_CODE.get(it.hazardClass);
    if (!cls) return jsonError(400, "validation_error", m.errors.validation);
    if (it.status === "CLASSIFIED") {
      const cat = cls.categories.find((k) => k.category === it.category);
      if (!cat) return jsonError(400, "validation_error", t.needCategory(cls.nameJa));
      rows.push({
        hazardClass: it.hazardClass,
        category: it.category,
        status: "CLASSIFIED",
        targetOrgans: it.targetOrgans?.trim().slice(0, 200) || null,
        hCodes: cat.hCodes?.join(",") || null,
      });
    } else if (["NOT_CLASSIFIED", "CANNOT_CLASSIFY", "NOT_APPLICABLE"].includes(it.status)) {
      rows.push({
        hazardClass: it.hazardClass,
        category: "",
        status: it.status,
        targetOrgans: null,
        hCodes: null,
      });
    } else {
      return jsonError(400, "validation_error", m.errors.validation);
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.sdsGhsOverride.deleteMany({ where: { substanceId: substance.id, country } });
    if (rows.length > 0) {
      await tx.sdsGhsOverride.createMany({
        data: rows.map((r) => ({
          ...r,
          substanceId: substance.id,
          country,
          reason,
          decidedBy: actor.user.id,
        })),
      });
    }
  });
  await writeAudit({
    entity: "sds_ghs_override",
    entityId: substance.id,
    action: "update",
    actorId: actor.user.id,
    diff: { substanceCode: substance.code, country, count: rows.length, reason },
  });
  return Response.json({ ok: true, count: rows.length });
}
