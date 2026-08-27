import { notFound } from "next/navigation";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { SubstanceCasScreen } from "@/components/substance-cas-screen";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { SUBSTANCE_INCLUDE, toStatutorySubstanceDto } from "@/lib/law-service";

/**
 * 法文物質名の対象CAS。
 *
 * 法文物質名の一覧でコードを押すと、ここへ移る。
 * 戻り先の区分は、分類をたどって引く（法文物質名の親は必ず分類）。
 */
export default async function StatutorySubstancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActor();
  if (!actor?.has("REGULATION_VIEW")) return <ForbiddenNotice />;
  const { id } = await params;

  const row = await prisma.statutorySubstance.findFirst({
    where: { id, deletedAt: null },
    include: {
      ...SUBSTANCE_INCLUDE,
      regulationClass: {
        select: {
          category: {
            select: { id: true, code: true, nameOriginal: true, nameJa: true, nameEn: true },
          },
        },
      },
    },
  });
  if (!row) notFound();

  /*
    同じ分類の中の前後。**分類はまたがない。**
    一覧が分類ごとのタブになっているので、そこと同じ範囲で動かす
  */
  const siblings = await prisma.statutorySubstance.findMany({
    where: { classId: row.classId, deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { codeNormalized: "asc" }],
    select: { id: true, code: true, nameJa: true, nameOriginal: true },
  });
  const at = siblings.findIndex((s) => s.id === row.id);
  const neighbour = (s: (typeof siblings)[number] | undefined) =>
    s
      ? { href: `/statutory-substances/${s.id}`, label: s.nameJa ?? s.nameOriginal ?? s.code }
      : null;

  return (
    <SubstanceCasScreen
      substance={toStatutorySubstanceDto(row)}
      category={row.regulationClass.category}
      prev={neighbour(siblings[at - 1])}
      next={neighbour(siblings[at + 1])}
    />
  );
}
