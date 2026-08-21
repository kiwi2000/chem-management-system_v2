import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/users/[id]/avatar — アバター画像そのものを返す。
 *
 * ログインしていれば誰の分でも見られる。名前と同じく、誰が書いたかを示すための
 * ものだからで、無い人は 404 を返す（画面側は頭文字の丸で代用する）。
 * 中身が変わったかどうかは更新日時で判断し、同じなら 304 で済ませる。
 */
export async function GET(req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { avatarData: true, avatarMime: true, avatarUpdatedAt: true },
  });
  if (!user?.avatarData || !user.avatarMime) return new Response(null, { status: 404 });

  const etag = `"${user.avatarUpdatedAt?.getTime() ?? 0}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(new Uint8Array(user.avatarData), {
    headers: {
      "Content-Type": user.avatarMime,
      ETag: etag,
      // 本人以外にも出るが、ログインした人だけのものなので共有の保管庫には置かせない
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
