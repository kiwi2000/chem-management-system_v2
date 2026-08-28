import { notFound } from "next/navigation";
import { CategoryScreen } from "@/components/category-screen";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { listLanguages } from "@/lib/language-service";
import { countSubstancesByCategory, toCategoryDto } from "@/lib/law-service";

/**
 * 規制区分の法文物質名。
 *
 * 法律の一覧で区分のコードを押すと、ここへ移る。
 * 区分そのものはここで引いて渡す（画面が開いた直後に見出しを出せるようにするため）。
 */
export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor?.has("REGULATION_VIEW")) return <ForbiddenNotice />;
  const { id } = await params;

  const row = await prisma.regulationCategory.findFirst({
    where: { id, deletedAt: null },
    include: {
      law: { select: { id: true, code: true, nameOriginal: true, nameJa: true, nameEn: true } },
    },
  });
  if (!row) notFound();

  /*
    同じ法律の区分を並び順で引き、前後を求める。
    **法律はまたがない。**隣の法律へ滑り込むと、いまどこにいるか分からなくなる
  */
  const siblings = await prisma.regulationCategory.findMany({
    where: { lawId: row.lawId, deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { codeNormalized: "asc" }],
    select: { id: true, code: true, nameJa: true, nameOriginal: true },
  });
  const at = siblings.findIndex((c) => c.id === row.id);
  const neighbour = (c: (typeof siblings)[number] | undefined) =>
    c ? { href: `/categories/${c.id}`, label: c.nameJa ?? c.nameOriginal ?? c.code } : null;

  const counts = await countSubstancesByCategory([row.id]);
  const languages = await listLanguages();

  return (
    <CategoryScreen
      languages={languages}
      category={toCategoryDto(row, counts.get(row.id) ?? 0)}
      prev={neighbour(siblings[at - 1])}
      next={neighbour(siblings[at + 1])}
      law={{
        id: row.law.id,
        code: row.law.code,
        nameOriginal: row.law.nameOriginal,
        nameJa: row.law.nameJa,
        nameEn: row.law.nameEn,
      }}
    />
  );
}
