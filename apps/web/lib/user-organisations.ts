import type { OrganisationKind } from "@chem/shared";

/**
 * 利用者に割り当てた組織の扱い。
 *
 * 割り当ては**種別を問わず何件でも**。ただし帳票の差出人やお知らせの所属のように
 * 「1つだけ要る」場面がある。そこでは**種別で絞って、組織の表示順で先頭のもの**を使う。
 * サーバーでも画面でも同じ決めかたにするため、ここに置く（DB や React に依存しない）。
 */

export interface OrganisationRef {
  id: string;
  kind: OrganisationKind;
  nameJa: string;
  displayOrder: number;
}

/** 組織の表示順、同じなら日本語名の順。管理画面の「組織」一覧と同じ並び */
export function sortOrganisations<T extends OrganisationRef>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.nameJa.localeCompare(b.nameJa, "ja"),
  );
}

/** 指定した種別のうち先頭のもの。無ければ null */
export function pickOrganisation<T extends OrganisationRef>(
  list: T[],
  kind: OrganisationKind,
): T | null {
  return sortOrganisations(list).find((o) => o.kind === kind) ?? null;
}
