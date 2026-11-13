import {
  PRODUCTS_COLUMNS,
  looksLikeCas,
  mapHeader,
  normalizeCas,
  normalizeCode,
  parseTable,
} from "@chem/shared";
import { canOn } from "@/lib/authz";
import { compositionAccessMany } from "@/lib/composition-access";
import { prisma } from "@/lib/db";
import {
  diffFields,
  editedByHuman,
  resolveOwner,
  type StageContext,
  type StagedRow,
} from "@/lib/import/types";
import { editableInState, visibilityWhere } from "@/lib/product-service";
import { visibilityWhere as substanceVisibility } from "@/lib/substance-service";

/**
 * 製品と組成の表（TSV）を一時領域の行にする。
 *
 * 行の読みかた: 同じ製品コードの行が 1 つの製品。製品名などは最初に出た行から取る。
 * CAS / 物質コード / 子製品コード のどれかがある行は、その製品の組成の 1 行。
 * 組成は**製品ごとに丸ごと置き換え**（画面の保存と同じ）。表に組成の行が 1 つも無い製品は、組成を触らない。
 * 物質は CAS（代表の物質）か物質コードで探し、無ければ ERROR（物質は先に物質の表で入れる）
 */

export interface ProductPayload {
  code: string;
  nameJa: string;
  nameEn: string | null;
  modelValue: string | null;
  uses: string[];
  usableAsMaterial: boolean;
  status: "ACTIVE" | "DISCONTINUED";
  note: string | null;
  /**
   * 所属先（S31。管理グループの id）。新しく作るときは必ず入る。
   * 既にある製品で null なら所属先を変えない（「画面で選んだ所属先」のとき）
   */
  ownerGroupId?: string | null;
}

export interface CompositionPayload {
  productCode: string;
  lines: {
    substanceId: string | null;
    childProductId: string | null;
    contentPct: string;
    note: string | null;
    label: string;
  }[];
}

/**
 * 公開の状態のせいで組成を直せないときの文（読み取りと反映で同じ文を出す）。
 * 決まりは画面と同じ（lib/product-service.ts の editableInState）
 */
export function compositionStateRefusal(state: string): string {
  return state === "PENDING"
    ? "承認待のものの組成は直せません（申請を取り下げてから直します）"
    : "公開前のものの組成は、作った本人しか直せません";
}

const PRODUCT_FIELDS = [
  "nameJa",
  "nameEn",
  "modelValue",
  "usableAsMaterial",
  "status",
  "note",
] as const;

function yes(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "○" || v === "はい" || v === "可" || v === "yes";
}

export async function stageProducts(
  text: string,
  ctx: StageContext,
): Promise<{
  rows: StagedRow[];
  errors: { line: number; message: string }[];
  notes: string[];
  count: number;
}> {
  const table = parseTable(text);
  const map = mapHeader(table.header, PRODUCTS_COLUMNS);
  const errors: { line: number; message: string }[] = [];
  const notes: string[] = [];
  if (map.missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `必須の列がありません: ${map.missing.join("、")}` }],
      notes,
      count: table.rows.length,
    };
  }
  if (map.unknown.length > 0) notes.push(`使わない列: ${map.unknown.join("、")}`);
  const col = (row: string[], k: string) => {
    const i = map.index[k];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };

  // 本体
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      codeNormalized: true,
      nameJa: true,
      nameEn: true,
      modelValue: true,
      usableAsMaterial: true,
      status: true,
      note: true,
      updatedBy: true,
      ownerGroupId: true,
      publishState: true,
      createdBy: true,
      compositionLines: {
        select: { substanceId: true, childProductId: true, contentPct: true, note: true },
        orderBy: { displayOrder: "asc" },
      },
    },
  });
  /*
    S31: 取り込む人に見えない製品は、無いものとして扱わない（コードは全体で一意なので作れない）。
    見えない製品と同じコードの行は「このコードは使えません」とだけ出す（見えないものの存在を知らせない）
  */
  const visibleIds = new Set(
    (
      await prisma.product.findMany({
        where: { deletedAt: null, ...visibilityWhere(ctx.actor) },
        select: { id: true },
      })
    ).map((p) => p.id),
  );
  const hiddenCodes = new Set(
    products.filter((p) => !visibleIds.has(p.id)).map((p) => p.codeNormalized),
  );
  const productMap = new Map(
    products.filter((p) => visibleIds.has(p.id)).map((p) => [p.codeNormalized, p]),
  );
  // 組成に使う物質は、取り込む人に見えるものだけから探す
  const substances = await prisma.substance.findMany({
    where: { deletedAt: null, ...substanceVisibility(ctx.actor) },
    select: {
      id: true,
      codeNormalized: true,
      casNormalized: true,
      isCasRepresentative: true,
      nameJa: true,
    },
  });
  const subByCode = new Map(substances.map((s) => [s.codeNormalized, s]));
  const subByCas = new Map<string, (typeof substances)[number]>();
  for (const s of substances) {
    if (!s.casNormalized) continue;
    const cur = subByCas.get(s.casNormalized);
    if (!cur || (s.isCasRepresentative && !cur.isCasRepresentative))
      subByCas.set(s.casNormalized, s);
  }

  // 表 → 製品ごとにまとめる
  const order: string[] = [];
  const byCode = new Map<
    string,
    {
      line: number;
      product: ProductPayload;
      lines: CompositionPayload["lines"];
      hasLines: boolean;
      ownerCode: string;
    }
  >();
  table.rows.forEach((row, i) => {
    const line = table.lineNumbers[i]!;
    const code = col(row, "productCode");
    if (!code) {
      errors.push({ line, message: "製品コードが空です" });
      return;
    }
    const codeN = normalizeCode(code);
    if (hiddenCodes.has(codeN)) {
      errors.push({ line, message: `製品「${code}」: このコードは使えません` });
      return;
    }
    let entry = byCode.get(codeN);
    if (!entry) {
      const existing = productMap.get(codeN);
      const name = col(row, "productName") || existing?.nameJa || "";
      if (!name) {
        errors.push({
          line,
          message: `製品「${code}」の製品名が空です（新しい製品には製品名が要ります）`,
        });
        return;
      }
      const statusRaw = col(row, "status");
      entry = {
        line,
        product: {
          code,
          nameJa: name,
          nameEn: col(row, "productNameEn") || existing?.nameEn || null,
          modelValue: col(row, "model") || existing?.modelValue || null,
          uses: col(row, "uses")
            ? col(row, "uses")
                .split(/[;；、,]/)
                .map((u) => u.trim())
                .filter(Boolean)
            : [],
          usableAsMaterial: col(row, "usableAsMaterial")
            ? yes(col(row, "usableAsMaterial"))
            : (existing?.usableAsMaterial ?? false),
          status: statusRaw
            ? /生産終了|discontinued|終了/i.test(statusRaw)
              ? "DISCONTINUED"
              : "ACTIVE"
            : (existing?.status ?? "ACTIVE"),
          note: col(row, "productNote") || existing?.note || null,
        },
        lines: [],
        hasLines: false,
        ownerCode: normalizeCode(col(row, "owner")),
      };
      byCode.set(codeN, entry);
      order.push(codeN);
    }
    const cas = col(row, "cas");
    const subCode = col(row, "substanceCode");
    const child = col(row, "childProductCode");
    if (!cas && !subCode && !child) return; // 製品だけの行
    const pctRaw = col(row, "contentPct").replace(/[%％\s]/g, "");
    const pctNum = Number(pctRaw);
    if (pctRaw === "" || !Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
      errors.push({
        line,
        message: `製品「${code}」の含有率が読めません: ${col(row, "contentPct")}`,
      });
      return;
    }
    entry.hasLines = true;
    if (child) {
      const cp = productMap.get(normalizeCode(child));
      if (!cp) {
        errors.push({
          line,
          message: `子製品「${child}」がありません（表の中で先に定義しても、反映は 2 回に分けてください）`,
        });
        return;
      }
      entry.lines.push({
        substanceId: null,
        childProductId: cp.id,
        contentPct: String(pctNum),
        note: col(row, "lineNote") || null,
        label: `${child} ${cp.nameJa}`,
      });
      return;
    }
    let s = subCode ? subByCode.get(normalizeCode(subCode)) : undefined;
    if (!s && cas) {
      const casN = normalizeCas(cas);
      if (!looksLikeCas(casN)) {
        errors.push({ line, message: `製品「${code}」の CAS の形が違います: ${cas}` });
        return;
      }
      s = subByCas.get(casN);
    }
    if (!s) {
      errors.push({
        line,
        message: `製品「${code}」の物質（${subCode || cas}）が物質マスタにありません。先に物質を入れてください`,
      });
      return;
    }
    entry.lines.push({
      substanceId: s.id,
      childProductId: null,
      contentPct: String(pctNum),
      note: col(row, "lineNote") || null,
      label: `${cas || subCode} ${s.nameJa}`,
    });
  });

  // 組成に入れる原材料は、取り込む人が組成を見られるものだけ（画面の候補と同じ。仕様 10 章）
  const childIds = [
    ...new Set(
      [...byCode.values()].flatMap((e) =>
        e.lines.flatMap((l) => (l.childProductId ? [l.childProductId] : [])),
      ),
    ),
  ];
  const childAccess = await compositionAccessMany(ctx.actor, childIds);
  const ownerCodeOf = new Map(ctx.owners.map((o) => [o.id, o.code]));

  const rows: StagedRow[] = [];
  for (const codeN of order) {
    const e = byCode.get(codeN)!;
    const cur = productMap.get(codeN);
    // 所属先（S31 仕様 7 章）
    const owner = resolveOwner(ctx, cur?.ownerGroupId ?? null, e.ownerCode, "productEdit");
    if (typeof owner === "string") {
      errors.push({ line: e.line, message: `製品「${e.product.code}」: ${owner}` });
      continue;
    }
    e.product.ownerGroupId = owner.target;
    const base = {
      kind: "product" as const,
      keyPath: e.product.code,
      label: e.product.nameJa,
      payload: e.product,
    };
    if (!cur) {
      rows.push({ ...base, action: "ADD", apply: true });
    } else {
      const diff = diffFields(cur, e.product as unknown as Record<string, unknown>, PRODUCT_FIELDS);
      if (owner.target && owner.target !== cur.ownerGroupId) {
        diff.ownerGroup = {
          current: ownerCodeOf.get(cur.ownerGroupId) ?? "",
          next: ownerCodeOf.get(owner.target) ?? "",
        };
      }
      if (Object.keys(diff).length === 0) rows.push({ ...base, action: "UNCHANGED", apply: false });
      else if (editedByHuman(cur.updatedBy))
        rows.push({
          ...base,
          action: "CONFLICT",
          apply: false,
          diff,
          message: "前回の取り込みのあとに画面で直されています",
        });
      else rows.push({ ...base, action: "UPDATE", apply: true, diff });
    }
    if (e.hasLines) {
      // 組成を直せるか: 所属先に「組成 編集」の印があり、入れる原材料の組成がどれも見えること
      const ownerNow = owner.target ?? cur?.ownerGroupId ?? "";
      const okLines = e.lines.every(
        (l) => !l.childProductId || childAccess.get(l.childProductId) !== "hidden",
      );
      if (!canOn(ctx.actor, "compositionEdit", ownerNow) || !okLines) {
        errors.push({ line: e.line, message: `製品「${e.product.code}」: 組成は直せません` });
        continue;
      }
      // 公開の状態は画面と同じ決まり（承認待は誰も直せない。作成中・却下は作った本人だけ）
      if (cur && !editableInState(ctx.actor, cur)) {
        errors.push({
          line: e.line,
          message: `製品「${e.product.code}」: ${compositionStateRefusal(cur.publishState)}`,
        });
        continue;
      }
      const payload: CompositionPayload = { productCode: e.product.code, lines: e.lines };
      const sig = (
        ls: { substanceId: string | null; childProductId: string | null; contentPct: unknown }[],
      ) =>
        ls
          .map((l) => `${l.substanceId ?? l.childProductId}:${Number(String(l.contentPct))}`)
          .sort()
          .join(";");
      const same = cur && sig(cur.compositionLines) === sig(e.lines);
      rows.push({
        kind: "composition",
        keyPath: `${e.product.code}/composition`,
        label: `${e.product.nameJa} の組成（${e.lines.length} 行）`,
        action: same ? "UNCHANGED" : cur ? "UPDATE" : "ADD",
        apply: !same,
        payload,
        diff:
          cur && !same
            ? { lines: { current: cur.compositionLines.length, next: e.lines.length } }
            : undefined,
      });
    }
  }
  return { rows, errors, notes, count: table.rows.length };
}
