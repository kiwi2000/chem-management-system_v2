import { requirePermission } from "@/lib/authz";
import { moveOwner, ownerMoveInfo } from "@/lib/owner-move";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/substances/[id]/owner — 所属先と、組成に使っている製品の数（所属先の変更の確かめに出す。S31） */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("SUBSTANCE_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  return ownerMoveInfo(actor, "substance", id);
}

/** POST /api/substances/[id]/owner — 所属先を移す（今の所属先と移す先の両方に「編集」の印が要る。S31 仕様 7 章） */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("SUBSTANCE_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  return moveOwner(actor, "substance", id, req);
}
