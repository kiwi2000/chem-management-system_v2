import type { ColumnFilter, Messages } from "@chem/shared";
import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";

/**
 * 規制対象CASの一覧・差分を「物質名」で絞るときの、CAS番号の範囲。
 *
 * どちらの行にも物質の名前は無いので、**物質の表（代表物質）と CAS番号で突き合わせる。**
 * Prisma は一意でない列（`cas_normalized`）での関連を張れないので、
 * **当たる物質を全部持ってくるのではなく、条件のまま DB に渡して結合させる**（2026-09-18 指摘）。
 *
 * **黙って切り詰めない。**以前は 2000 件で打ち切っており、
 * それを超えると出るはずの行が消えたまま、件数だけがもっともらしく出ていた。
 * 法文物質名の「結び付いた物質の名前」（lib/law-service.ts）と同じ直しかたにそろえてある
 */

/**
 * 上限。超えたら切り詰めずに断る。
 * 数そのものは、PostgreSQL が1つの問い合わせに取れる値の数（65535）に届かない範囲で決めている
 */
const CAS_NAME_MAX = 50000;

/** LIKE の特殊文字（% _ \）を、そのままの文字として扱わせる */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** 打った条件を LIKE の形にする（欄の「を含む」「で始まる」…をそのまま使う） */
function likePattern(filter: Extract<ColumnFilter, { kind: "text" }>): string | null {
  const value = filter.value.trim();
  if (value === "") return null;
  const lit = likeLiteral(value);
  if (filter.op === "startsWith") return `${lit}%`;
  if (filter.op === "endsWith") return `%${lit}`;
  if (filter.op === "equals") return lit;
  return `%${lit}%`;
}

/**
 * 物質名に当たる CAS番号を、その版・データソースにあるものだけ集める。
 *
 * - 絞り込みが無ければ `null`（範囲で絞らない）
 * - 1件も当たらなければ空の配列（＝1行も出さない）
 * - 多すぎるときは、切り詰めた結果を出さずに 400 を返す
 */
export async function casScopeByName(
  scope: { versionId: string; sourceId: string; againstId?: string },
  filter: ColumnFilter | undefined,
  m: Messages,
): Promise<string[] | Response | null> {
  if (!filter || filter.kind !== "text") return null;
  // 「空」「空でない」は、名前の有無ではなく代表物質の有無になってしまうので見ない
  if (filter.op === "empty" || filter.op === "notEmpty") return null;
  const pattern = likePattern(filter);
  if (pattern === null) return null;

  const rows = scope.againstId
    ? await prisma.$queryRaw<{ cas_normalized: string }[]>`
        SELECT DISTINCT d.cas_normalized
        FROM statutory_cas_link_diffs d
        JOIN substances s
          ON s.cas_normalized = d.cas_normalized
         AND s.deleted_at IS NULL
         AND s.is_cas_representative = true
        WHERE d.version_id = ${scope.versionId}::text
          AND d.against_id = ${scope.againstId}::text
          AND d.source_id = ${scope.sourceId}::text
          AND (LOWER(s.name_ja) LIKE LOWER(${pattern}) OR LOWER(s.name_en) LIKE LOWER(${pattern}))
        LIMIT ${CAS_NAME_MAX + 1}
      `
    : await prisma.$queryRaw<{ cas_normalized: string }[]>`
        SELECT DISTINCT l.cas_normalized
        FROM statutory_cas_links l
        JOIN substances s
          ON s.cas_normalized = l.cas_normalized
         AND s.deleted_at IS NULL
         AND s.is_cas_representative = true
        WHERE l.version_id = ${scope.versionId}::text
          AND l.source_id = ${scope.sourceId}::text
          AND (LOWER(s.name_ja) LIKE LOWER(${pattern}) OR LOWER(s.name_en) LIKE LOWER(${pattern}))
        LIMIT ${CAS_NAME_MAX + 1}
      `;
  if (rows.length > CAS_NAME_MAX) {
    return jsonError(400, "too_many_matches", m.casLinks.casNameTooMany);
  }
  return rows.map((r) => r.cas_normalized);
}
