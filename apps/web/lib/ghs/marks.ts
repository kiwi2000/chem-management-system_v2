import type { GhsLayerMarks } from "@/components/ghs/ghs-marks";
import { prisma } from "@/lib/db";

/**
 * GHS の層の印に使うデータソース（2026-10-17）。LOLI の結び付き → データソース LOLI、自社判定 → データソース USER。
 * 色と文字は法規制の画面と同じ（データソースの画面で決める）。画面を見る人の権限に関わらず、サーバーで引いて渡す
 */
export async function ghsLayerMarks(): Promise<GhsLayerMarks> {
  const rows = await prisma.source.findMany({
    where: { codeNormalized: { in: ["LOLI", "USER"] }, deletedAt: null },
    select: { id: true, code: true, codeNormalized: true, color: true, mark: true },
  });
  const pick = (code: string) => {
    const s = rows.find((r) => r.codeNormalized === code);
    return s ? { id: s.id, code: s.code, color: s.color, mark: s.mark } : null;
  };
  const out: GhsLayerMarks = {};
  const loli = pick("LOLI");
  const user = pick("USER");
  if (loli) out.LOLI = loli;
  if (user) out.OVERRIDE = user;
  return out;
}
