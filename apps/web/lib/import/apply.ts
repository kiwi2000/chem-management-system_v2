import { normalizeCas, normalizeCode } from "@chem/shared";
import type {
  AggregationMode,
  ImportAction,
  ImportKind,
  ProductStatus,
  PublishState,
  ThresholdBasis,
  ThresholdBound,
} from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { expandProduct, findAffected, saveExpansion } from "@/lib/expansion-store";
import { markDone, markRunning } from "@/lib/import/jobs";
import { USER_SOURCE_CODE } from "@/lib/import/read-regulation-list";
import type { CompositionPayload, ProductPayload } from "@/lib/import/stage-products";
import type { SubstancePayload } from "@/lib/import/stage-substances";
import { importActor, type ApplySummary, type RowKind } from "@/lib/import/types";
import { judgeProduct, loadFactors, loadRules } from "@/lib/judge-store";
import { todayInJapan } from "@/lib/judgement-date";
import { recomputeAllScores } from "@/lib/score-store";
import { getAppSettings } from "@/lib/settings";
import { ensureCasRepresentative } from "@/lib/substance-service";

/**
 * 一時領域の行を本体に反映する（決定 0011）。**足す・更新するだけで、消さない。**
 * 反映する行は apply = true のもの（ADD / UPDATE と、人が反映すると決めた CONFLICT）。
 * 書いた行の updated_by には `import:<取り込みの番号>` を入れ、次回の取り込みで人の手直しと見分ける。
 * 裏で回し、進み具合は ImportJob.progress に書く
 */

const APPLIED: ImportAction[] = ["ADD", "UPDATE", "CONFLICT"];

export function startApply(jobId: string, actorId: string): boolean {
  if (!markRunning(jobId, "apply")) return false;
  void runApply(jobId, actorId).finally(() => markDone(jobId));
  return true;
}

interface Row {
  id: string;
  kind: string;
  keyPath: string;
  action: ImportAction;
  payload: unknown;
}

async function* rowsOf(jobId: string, kind: RowKind): AsyncGenerator<Row[]> {
  let cursor: number | null = null;
  for (;;) {
    const page: (Row & { seq: number })[] = await prisma.importRow.findMany({
      where: {
        jobId,
        kind,
        apply: true,
        action: { in: APPLIED },
        ...(cursor ? { seq: { gt: cursor } } : {}),
      },
      orderBy: { seq: "asc" },
      take: 2000,
      select: { id: true, kind: true, keyPath: true, action: true, payload: true, seq: true },
    });
    if (page.length === 0) return;
    yield page;
    cursor = page[page.length - 1]!.seq;
    if (page.length < 2000) return;
  }
}

async function runApply(jobId: string, actorId: string) {
  const started = Date.now();
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "APPLYING", progress: 0, error: null },
  });
  const summary: ApplySummary = { applied: {}, skipped: 0, failed: 0, ms: 0 };
  const total = await prisma.importRow.count({
    where: { jobId, apply: true, action: { in: APPLIED } },
  });
  let done = 0;
  const tick = async (n: number) => {
    done += n;
    await prisma.importJob.update({
      where: { id: jobId },
      data: { progress: total ? Math.min(99, Math.floor((done / total) * 100)) : 99 },
    });
  };
  const count = (kind: string, n = 1) => {
    summary.applied[kind] = (summary.applied[kind] ?? 0) + n;
  };
  const fail = async (row: Row, message: string) => {
    summary.failed += 1;
    await prisma.importRow.update({
      where: { id: row.id },
      data: { message: `反映できませんでした: ${message}`.slice(0, 500) },
    });
  };

  try {
    if (job.kind === "DATA_SET" || job.kind === "REGULATION_LIST") {
      await applyRegulation(jobId, job.kind, { count, fail, tick });
    } else if (job.kind === "PRODUCTS") {
      await applyProducts(jobId, actorId, { count, fail, tick });
    } else {
      await applySubstances(jobId, actorId, { count, fail, tick });
    }
    summary.ms = Date.now() - started;
    const prev = (job.summary ?? {}) as Record<string, unknown>;
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "DONE",
        progress: 100,
        appliedAt: new Date(),
        appliedBy: actorId,
        fileData: null, // 反映が済んだファイルは持たない（記録は summary に残る）
        summary: { ...prev, apply: summary } as object,
      },
    });
    await writeAudit({
      entity: "import_jobs",
      entityId: jobId,
      action: "import",
      actorId,
      diff: { kind: job.kind, fileName: job.fileName, ...summary },
    });
  } catch (e) {
    console.error("import apply failed:", jobId, e);
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) },
    });
  }
}

interface Hooks {
  count: (kind: string, n?: number) => void;
  fail: (row: Row, message: string) => Promise<void>;
  tick: (n: number) => Promise<void>;
}

const day = (v: unknown): Date | null => (typeof v === "string" && v ? new Date(v) : null);
const str = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);
const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// ─────────────────────────────────────────────────────────────────────────────
// 法規制（データセット・規制リスト）
// ─────────────────────────────────────────────────────────────────────────────
async function applyRegulation(jobId: string, kind: ImportKind, h: Hooks) {
  const by = importActor(jobId);
  const audit = { createdBy: by, updatedBy: by };

  // コード → id の対応（都度引かずに持つ）
  const countries = new Map(
    (await prisma.country.findMany({ select: { id: true, codeNormalized: true } })).map((c) => [
      c.codeNormalized,
      c.id,
    ]),
  );
  const sources = new Map(
    (await prisma.source.findMany({ select: { id: true, codeNormalized: true } })).map((s) => [
      s.codeNormalized,
      s.id,
    ]),
  );
  const versions = new Map(
    (await prisma.linkSetVersion.findMany({ select: { id: true, codeNormalized: true } })).map(
      (v) => [v.codeNormalized, v.id],
    ),
  );
  const laws = new Map(
    (await prisma.law.findMany({ select: { id: true, codeNormalized: true } })).map((l) => [
      l.codeNormalized,
      l.id,
    ]),
  );
  const categories = new Map<string, string>();
  const classes = new Map<string, string>();
  const substances = new Map<string, string>();
  const lawIdOf = (code: string) => laws.get(normalizeCode(code));
  const catKey = (law: string, cat: string) => `${normalizeCode(law)}/${normalizeCode(cat)}`;
  const clsKey = (law: string, cat: string, cls: string) =>
    `${catKey(law, cat)}/${normalizeCode(cls)}`;
  const subKey = (law: string, cat: string, cls: string, sub: string) =>
    `${clsKey(law, cat, cls)}/${normalizeCode(sub)}`;
  // 既存の区分・分類・法文物質名の id（コードの道筋で）
  for (const c of await prisma.regulationCategory.findMany({
    select: { id: true, codeNormalized: true, law: { select: { codeNormalized: true } } },
  })) {
    categories.set(`${c.law.codeNormalized}/${c.codeNormalized}`, c.id);
  }
  for (const k of await prisma.regulationClass.findMany({
    select: {
      id: true,
      codeNormalized: true,
      category: { select: { codeNormalized: true, law: { select: { codeNormalized: true } } } },
    },
  })) {
    classes.set(
      `${k.category.law.codeNormalized}/${k.category.codeNormalized}/${k.codeNormalized}`,
      k.id,
    );
  }
  for (const s of await prisma.statutorySubstance.findMany({
    select: {
      id: true,
      codeNormalized: true,
      regulationClass: {
        select: {
          codeNormalized: true,
          category: { select: { codeNormalized: true, law: { select: { codeNormalized: true } } } },
        },
      },
    },
  })) {
    const k = s.regulationClass;
    substances.set(
      `${k.category.law.codeNormalized}/${k.category.codeNormalized}/${k.codeNormalized}/${s.codeNormalized}`,
      s.id,
    );
  }

  // 地域 → 国 → 元素 → 金属換算係数（法律より先。空の DB に取り込めるように）
  const regions = new Map(
    (await prisma.region.findMany({ select: { id: true, codeNormalized: true } })).map((r) => [
      r.codeNormalized,
      r.id,
    ]),
  );
  for await (const page of rowsOf(jobId, "region")) {
    for (const row of page) {
      const p = row.payload as {
        code: string;
        nameJa: string;
        nameEn: string | null;
        displayOrder: number;
      };
      const codeN = normalizeCode(p.code);
      const data = { nameJa: p.nameJa, nameEn: p.nameEn, displayOrder: p.displayOrder };
      const id = regions.get(codeN);
      if (!id) {
        const r = await prisma.region.create({
          data: { code: p.code, codeNormalized: codeN, ...data, ...audit },
        });
        regions.set(codeN, r.id);
      } else {
        await prisma.region.update({ where: { id }, data: { ...data, updatedBy: by } });
      }
      h.count("region");
    }
    await h.tick(page.length);
  }
  for await (const page of rowsOf(jobId, "country")) {
    for (const row of page) {
      const p = row.payload as {
        code: string;
        regionCode: string;
        nameJa: string;
        nameEn: string | null;
        displayOrder: number;
      };
      const codeN = normalizeCode(p.code);
      const regionId = regions.get(normalizeCode(p.regionCode));
      if (!regionId) {
        await h.fail(row, `地域「${p.regionCode}」がありません`);
        continue;
      }
      const data = { regionId, nameJa: p.nameJa, nameEn: p.nameEn, displayOrder: p.displayOrder };
      const id = countries.get(codeN);
      if (!id) {
        const c = await prisma.country.create({
          data: { code: p.code, codeNormalized: codeN, ...data, ...audit },
        });
        countries.set(codeN, c.id);
      } else {
        await prisma.country.update({ where: { id }, data: { ...data, updatedBy: by } });
      }
      h.count("country");
    }
    await h.tick(page.length);
  }
  for await (const page of rowsOf(jobId, "element")) {
    for (const row of page) {
      const p = row.payload as {
        symbol: string;
        atomicNumber: number;
        nameJa: string;
        nameEn: string;
      };
      await prisma.element.upsert({
        where: { symbol: p.symbol },
        create: {
          symbol: p.symbol,
          atomicNumber: p.atomicNumber,
          nameJa: p.nameJa,
          nameEn: p.nameEn,
          ...audit,
        },
        update: { atomicNumber: p.atomicNumber, nameJa: p.nameJa, nameEn: p.nameEn, updatedBy: by },
      });
      h.count("element");
    }
    await h.tick(page.length);
  }
  for await (const page of rowsOf(jobId, "factor")) {
    for (const row of page) {
      const p = row.payload as {
        cas: string;
        casNumber: string;
        element: string;
        ratioPct: string;
        note: string | null;
      };
      const casN = normalizeCas(p.cas);
      await prisma.metalConversionFactor.upsert({
        where: { casNormalized_metalElement: { casNormalized: casN, metalElement: p.element } },
        create: {
          casNumber: p.casNumber,
          casNormalized: casN,
          metalElement: p.element,
          ratioPct: p.ratioPct,
          note: p.note,
          ...audit,
        },
        update: { casNumber: p.casNumber, ratioPct: p.ratioPct, note: p.note, updatedBy: by },
      });
      h.count("factor");
    }
    await h.tick(page.length);
  }

  for await (const page of rowsOf(jobId, "source")) {
    for (const row of page) {
      const p = row.payload as { code: string };
      const codeN = normalizeCode(p.code);
      if (!sources.has(codeN)) {
        const s = await prisma.source.create({
          data: { code: p.code, codeNormalized: codeN, ...audit },
        });
        sources.set(codeN, s.id);
      }
      h.count("source");
    }
    await h.tick(page.length);
  }
  for await (const page of rowsOf(jobId, "version")) {
    for (const row of page) {
      const p = row.payload as { code: string; asOf: string };
      const codeN = normalizeCode(p.code);
      const id = versions.get(codeN);
      if (!id) {
        const v = await prisma.linkSetVersion.create({
          data: {
            code: p.code,
            codeNormalized: codeN,
            asOf: new Date(p.asOf),
            isCurrent: false,
            ...audit,
          },
        });
        versions.set(codeN, v.id);
      } else {
        await prisma.linkSetVersion.update({
          where: { id },
          data: { asOf: new Date(p.asOf), updatedBy: by },
        });
      }
      h.count("version");
    }
    await h.tick(page.length);
  }
  for await (const page of rowsOf(jobId, "law")) {
    for (const row of page) {
      const p = row.payload as Record<string, unknown>;
      const countryId = countries.get(normalizeCode(String(p.countryCode ?? "")));
      if (!countryId) {
        await h.fail(row, `国「${p.countryCode}」がありません`);
        continue;
      }
      const codeN = normalizeCode(String(p.code));
      const data = {
        countryId,
        nameOriginal: String(p.nameOriginal),
        nameLang: String(p.nameLang ?? "JA"),
        nameJa: str(p.nameJa),
        nameEn: str(p.nameEn),
        displayOrder: num(p.displayOrder, 0),
        note: str(p.note),
      };
      const id = laws.get(codeN);
      if (!id) {
        const l = await prisma.law.create({
          data: { code: String(p.code), codeNormalized: codeN, ...data, ...audit },
        });
        laws.set(codeN, l.id);
      } else {
        await prisma.law.update({ where: { id }, data: { ...data, updatedBy: by } });
      }
      h.count("law");
    }
    await h.tick(page.length);
  }
  for await (const page of rowsOf(jobId, "category")) {
    for (const row of page) {
      const p = row.payload as Record<string, unknown>;
      const lawId = lawIdOf(String(p.lawCode));
      if (!lawId) {
        await h.fail(row, `法律「${p.lawCode}」がありません`);
        continue;
      }
      const k = catKey(String(p.lawCode), String(p.code));
      const data = {
        nameOriginal: String(p.nameOriginal),
        nameLang: String(p.nameLang ?? "JA"),
        nameJa: str(p.nameJa),
        nameEn: str(p.nameEn),
        displayOrder: num(p.displayOrder, 0),
        thresholdLower: String(p.thresholdLower ?? "0"),
        lowerBound: String(p.lowerBound ?? "EXCLUSIVE") as ThresholdBound,
        thresholdUpper: String(p.thresholdUpper ?? "100"),
        upperBound: String(p.upperBound ?? "INCLUSIVE") as ThresholdBound,
        aggregation: String(p.aggregation ?? "NONE") as AggregationMode,
        metalEtc: str(p.metalEtc),
        thresholdBasis: String(p.thresholdBasis ?? "PRODUCT") as ThresholdBasis,
        judged: p.judged !== false,
        effectiveFrom: day(p.effectiveFrom),
        effectiveTo: day(p.effectiveTo),
        interactionGroup: str(p.interactionGroup),
        rank: p.rank === null || p.rank === undefined ? null : num(p.rank, 0),
        score: String(p.score ?? "0"),
        note: str(p.note),
      };
      const id = categories.get(k);
      if (!id) {
        const c = await prisma.regulationCategory.create({
          data: {
            lawId,
            code: String(p.code),
            codeNormalized: normalizeCode(String(p.code)),
            ...data,
            ...audit,
          },
        });
        categories.set(k, c.id);
      } else {
        await prisma.regulationCategory.update({ where: { id }, data: { ...data, updatedBy: by } });
      }
      h.count("category");
    }
    await h.tick(page.length);
  }
  for await (const page of rowsOf(jobId, "class")) {
    for (const row of page) {
      const p = row.payload as Record<string, unknown>;
      const categoryId = categories.get(catKey(String(p.lawCode), String(p.categoryCode)));
      if (!categoryId) {
        await h.fail(row, `規制区分「${p.lawCode}/${p.categoryCode}」がありません`);
        continue;
      }
      const k = clsKey(String(p.lawCode), String(p.categoryCode), String(p.code));
      const data = {
        nameOriginal: str(p.nameOriginal),
        nameLang: str(p.nameLang),
        nameJa: str(p.nameJa),
        nameEn: str(p.nameEn),
        displayOrder: num(p.displayOrder, 0),
        interactionGroup: str(p.interactionGroup),
        rank: p.rank === null || p.rank === undefined ? null : num(p.rank, 0),
        note: str(p.note),
      };
      const id = classes.get(k);
      if (!id) {
        const c = await prisma.regulationClass.create({
          data: {
            categoryId,
            code: String(p.code),
            codeNormalized: normalizeCode(String(p.code)),
            ...data,
            ...audit,
          },
        });
        classes.set(k, c.id);
      } else {
        await prisma.regulationClass.update({ where: { id }, data: { ...data, updatedBy: by } });
      }
      h.count("class");
    }
    await h.tick(page.length);
  }
  for await (const page of rowsOf(jobId, "substance")) {
    for (const row of page) {
      const p = row.payload as Record<string, unknown>;
      const classId = classes.get(
        clsKey(String(p.lawCode), String(p.categoryCode), String(p.classCode)),
      );
      if (!classId) {
        await h.fail(row, `分類「${p.lawCode}/${p.categoryCode}/${p.classCode}」がありません`);
        continue;
      }
      const k = subKey(
        String(p.lawCode),
        String(p.categoryCode),
        String(p.classCode),
        String(p.code),
      );
      const data = {
        officialNumber: str(p.officialNumber),
        nameOriginal: String(p.nameOriginal),
        nameLang: String(p.nameLang ?? "JA"),
        nameJa: str(p.nameJa),
        nameEn: str(p.nameEn),
        displayOrder: num(p.displayOrder, 0),
        // 空の欄は空のまま入れる（区分の既定値に従う）
        thresholdLower: str(p.thresholdLower),
        lowerBound: str(p.lowerBound) as ThresholdBound | null,
        thresholdUpper: str(p.thresholdUpper),
        upperBound: str(p.upperBound) as ThresholdBound | null,
        aggregation: String(p.aggregation ?? "NONE") as AggregationMode,
        metalEtc: str(p.metalEtc),
        effectiveFrom: day(p.effectiveFrom),
        effectiveTo: day(p.effectiveTo),
        applicableCondition: str(p.applicableCondition),
        note: str(p.note),
      };
      const id = substances.get(k);
      if (!id) {
        const s = await prisma.statutorySubstance.create({
          data: {
            classId,
            code: String(p.code),
            codeNormalized: normalizeCode(String(p.code)),
            ...data,
            ...audit,
          },
        });
        substances.set(k, s.id);
      } else {
        await prisma.statutorySubstance.update({ where: { id }, data: { ...data, updatedBy: by } });
      }
      h.count("substance");
    }
    await h.tick(page.length);
  }

  // 結び付き。ADD は createMany でまとめ、出典データは作った行の id を引き直して入れる
  const pairs = new Set<string>(); // `${versionId}|${sourceId}`
  for await (const page of rowsOf(jobId, "link")) {
    type L = {
      versionId: string;
      sourceId: string;
      statutorySubstanceId: string;
      casNumber: string;
      casNormalized: string;
      excluded: boolean;
      note: string | null;
      text: string | null;
      textJa: string | null;
    };
    const adds: L[] = [];
    for (const row of page) {
      const p = row.payload as Record<string, unknown>;
      const versionId = versions.get(normalizeCode(String(p.version)));
      const sourceId = sources.get(normalizeCode(String(p.source)));
      const substanceId = substances.get(
        subKey(
          String(p.lawCode),
          String(p.categoryCode),
          String(p.classCode),
          String(p.substanceCode),
        ),
      );
      if (!versionId || !sourceId || !substanceId) {
        await h.fail(row, "バージョン・データソース・法文物質名のどれかが本体にありません");
        continue;
      }
      pairs.add(`${versionId}|${sourceId}`);
      const l: L = {
        versionId,
        sourceId,
        statutorySubstanceId: substanceId,
        casNumber: String(p.casNumber ?? p.cas),
        casNormalized: normalizeCas(String(p.cas)),
        excluded: p.excluded === true,
        note: str(p.note),
        text: str(p.text),
        textJa: str(p.textJa),
      };
      if (row.action === "ADD") {
        adds.push(l);
      } else {
        const cur = await prisma.statutoryCasLink.findFirst({
          where: {
            versionId,
            sourceId,
            statutorySubstanceId: substanceId,
            casNormalized: l.casNormalized,
          },
          select: { id: true },
        });
        if (!cur) {
          adds.push(l);
        } else {
          await prisma.statutoryCasLink.update({
            where: { id: cur.id },
            data: { casNumber: l.casNumber, excluded: l.excluded, note: l.note, updatedBy: by },
          });
          if (l.text !== null) {
            await prisma.statutoryCasLinkData.upsert({
              where: { linkId: cur.id },
              update: { text: l.text, textJa: l.textJa },
              create: { linkId: cur.id, text: l.text, textJa: l.textJa },
            });
          }
          h.count("link");
        }
      }
    }
    if (adds.length > 0) {
      await prisma.statutoryCasLink.createMany({
        data: adds.map(({ text: _t, textJa: _tj, ...l }) => ({ ...l, ...audit })),
        skipDuplicates: true,
      });
      const withText = adds.filter((l) => l.text !== null);
      if (withText.length > 0) {
        const created = await prisma.statutoryCasLink.findMany({
          where: {
            OR: withText.map((l) => ({
              versionId: l.versionId,
              sourceId: l.sourceId,
              statutorySubstanceId: l.statutorySubstanceId,
              casNormalized: l.casNormalized,
            })),
          },
          select: {
            id: true,
            versionId: true,
            sourceId: true,
            statutorySubstanceId: true,
            casNormalized: true,
          },
        });
        const idOf = new Map(
          created.map((c) => [
            `${c.versionId}|${c.sourceId}|${c.statutorySubstanceId}|${c.casNormalized}`,
            c.id,
          ]),
        );
        const data = withText
          .map((l) => {
            const id = idOf.get(
              `${l.versionId}|${l.sourceId}|${l.statutorySubstanceId}|${l.casNormalized}`,
            );
            return id ? { linkId: id, text: l.text!, textJa: l.textJa } : null;
          })
          .filter((d): d is { linkId: string; text: string; textJa: string | null } => d !== null);
        if (data.length > 0)
          await prisma.statutoryCasLinkData.createMany({ data, skipDuplicates: true });
      }
      h.count("link", adds.length);
    }
    await h.tick(page.length);
  }

  // バージョン × データソースの並び。無ければ足す（USER は先頭 = 優先、ほかは末尾）
  for (const pair of pairs) {
    const [versionId, sourceId] = pair.split("|") as [string, string];
    const exists = await prisma.linkVersionSource.findFirst({
      where: { versionId, sourceId },
      select: { id: true },
    });
    if (exists) continue;
    const src = await prisma.source.findUnique({
      where: { id: sourceId },
      select: { codeNormalized: true },
    });
    const others = await prisma.linkVersionSource.findMany({
      where: { versionId },
      orderBy: { priority: "desc" },
      select: { id: true, priority: true },
    });
    if (src?.codeNormalized === USER_SOURCE_CODE) {
      // 先頭に入れる。ぶつからないよう後ろから 1 つずつずらす
      await prisma.$transaction(async (tx) => {
        for (const o of others)
          await tx.linkVersionSource.update({
            where: { id: o.id },
            data: { priority: o.priority + 1 },
          });
        await tx.linkVersionSource.create({ data: { versionId, sourceId, priority: 1, ...audit } });
      });
    } else {
      const max = others[0]?.priority ?? 0;
      await prisma.linkVersionSource.create({
        data: { versionId, sourceId, priority: max + 1, ...audit },
      });
    }
  }

  // 物質のスコアは結び付きから決まるので、まとめて計算し直す（判定は管理者が「全製品を判定し直す」を押す）
  if (kind === "DATA_SET" || kind === "REGULATION_LIST") {
    await recomputeAllScores().catch((e) => console.error("score recompute failed:", e));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 製品と組成
// ─────────────────────────────────────────────────────────────────────────────
async function applyProducts(jobId: string, actorId: string, h: Hooks) {
  const by = importActor(jobId);
  /*
    新しく作るものの「作った人」は反映した人にする（作成中のものは作った人にしか見えないため。
    取り込みの印だと誰にも見えない）。「更新した人」は取り込みの印のまま（次の取り込みで、
    そのあと人が直したかを見分けるのに使う）。
    公開の状態は、承認が要らない設定なら公開済、要るなら作成中（画面から申請してもらう）
  */
  const settings = await getAppSettings();
  const audit = {
    createdBy: actorId,
    updatedBy: by,
    publishState: (settings.productApprovalRequired ? "DRAFT" : "PUBLISHED") as PublishState,
  };
  const products = new Map(
    (
      await prisma.product.findMany({
        where: { deletedAt: null },
        select: { id: true, codeNormalized: true },
      })
    ).map((p) => [p.codeNormalized, p.id]),
  );
  const touched = new Set<string>();

  for await (const page of rowsOf(jobId, "product")) {
    for (const row of page) {
      const p = row.payload as ProductPayload;
      const codeN = normalizeCode(p.code);
      const data = {
        nameJa: p.nameJa,
        nameEn: p.nameEn,
        modelValue: p.modelValue,
        usableAsMaterial: p.usableAsMaterial,
        status: p.status as ProductStatus,
        note: p.note,
      };
      const id = products.get(codeN);
      if (!id) {
        const c = await prisma.product.create({
          data: {
            code: p.code,
            codeNormalized: codeN,
            ...data,
            ...audit,
            uses: { create: p.uses.map((u, i) => ({ value: u, displayOrder: i + 1 })) },
          },
        });
        products.set(codeN, c.id);
        touched.add(c.id);
      } else {
        await prisma.product.update({ where: { id }, data: { ...data, updatedBy: by } });
        if (p.uses.length > 0) {
          await prisma.productUse.deleteMany({ where: { productId: id } });
          await prisma.productUse.createMany({
            data: p.uses.map((u, i) => ({ productId: id, value: u, displayOrder: i + 1 })),
          });
        }
        touched.add(id);
      }
      h.count("product");
    }
    await h.tick(page.length);
  }
  for await (const page of rowsOf(jobId, "composition")) {
    for (const row of page) {
      const p = row.payload as CompositionPayload;
      const id = products.get(normalizeCode(p.productCode));
      if (!id) {
        await h.fail(row, `製品「${p.productCode}」がありません`);
        continue;
      }
      await prisma.$transaction([
        prisma.compositionLine.deleteMany({ where: { parentProductId: id } }),
        prisma.compositionLine.createMany({
          data: p.lines.map((l, i) => ({
            parentProductId: id,
            substanceId: l.substanceId,
            childProductId: l.childProductId,
            contentPct: l.contentPct,
            note: l.note,
            displayOrder: i + 1,
          })),
        }),
        prisma.product.update({ where: { id }, data: { updatedBy: by } }),
      ]);
      touched.add(id);
      h.count("composition");
    }
    await h.tick(page.length);
  }

  // 展開と判定を作り直す（画面の保存と同じ。決めごとは 1 回だけ読む）
  if (touched.size > 0) {
    const targets = new Set<string>();
    for (const id of touched) for (const t of await findAffected(id)) targets.add(t);
    const version = await prisma.linkSetVersion.findFirst({
      where: { isCurrent: true, deletedAt: null },
      select: { id: true },
    });
    // 取り込みの判定は今日を判定対象日にする（自動の判定と同じ）
    const asOf = todayInJapan();
    const [rules, factors, settings] = version
      ? await Promise.all([loadRules(version.id, asOf), loadFactors(), getAppSettings()])
      : [null, null, null];
    for (const id of targets) {
      await saveExpansion(id, await expandProduct(id));
      if (version && rules && factors && settings) {
        await judgeProduct(id, rules, factors, {
          asOf,
          trigger: "IMPORT",
          conditionalLinkMode: settings.conditionalLinkMode,
          versionId: version.id,
        });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 物質
// ─────────────────────────────────────────────────────────────────────────────
async function applySubstances(jobId: string, actorId: string, h: Hooks) {
  const by = importActor(jobId);
  // 作った人・公開の状態の決めかたは製品と同じ（applyProducts を参照）
  const settings = await getAppSettings();
  const audit = {
    createdBy: actorId,
    updatedBy: by,
    publishState: (settings.substanceApprovalRequired ? "DRAFT" : "PUBLISHED") as PublishState,
  };
  const existing = new Map(
    (
      await prisma.substance.findMany({
        where: { deletedAt: null },
        select: { id: true, codeNormalized: true },
      })
    ).map((s) => [s.codeNormalized, s.id]),
  );
  for await (const page of rowsOf(jobId, "substance_master")) {
    for (const row of page) {
      const p = row.payload as SubstancePayload;
      const codeN = normalizeCode(p.code);
      const casN = p.casNumber ? normalizeCas(p.casNumber) : null;
      const data = {
        nameJa: p.nameJa,
        nameEn: p.nameEn,
        casNumber: casN,
        casNormalized: casN,
        note: p.note,
      };
      let id = existing.get(codeN);
      if (!id) {
        const s = await prisma.substance.create({
          data: { code: p.code, codeNormalized: codeN, ...data, ...audit },
        });
        id = s.id;
        existing.set(codeN, id);
      } else {
        await prisma.substance.update({ where: { id }, data: { ...data, updatedBy: by } });
      }
      if (p.aliases.length > 0) {
        const have = new Set(
          (
            await prisma.substanceAlias.findMany({
              where: { substanceId: id },
              select: { nameJa: true },
            })
          ).map((a) => a.nameJa),
        );
        const fresh = p.aliases.filter((a) => !have.has(a));
        if (fresh.length > 0) {
          await prisma.substanceAlias.createMany({
            data: fresh.map((a, i) => ({
              substanceId: id!,
              nameJa: a,
              displayOrder: have.size + i + 1,
            })),
          });
        }
      }
      if (casN) await ensureCasRepresentative(prisma, casN);
      h.count("substance_master");
    }
    await h.tick(page.length);
  }
}
