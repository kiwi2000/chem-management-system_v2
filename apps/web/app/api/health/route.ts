import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — 稼働確認。
 * 認証を通さない（監視・デプロイ確認用）。中身は「アプリが動くか」「DBに繋がるか」だけで、
 * 業務データは一切返さない。authz 呼び忘れ検出テストの allowlist に入っている。
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: "up" });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
