import type { Prisma } from "@prisma/client";
import type { SavedFilterDto } from "@/lib/types";

type Row = Prisma.SavedFilterGetPayload<{
  include: { owner: { select: { displayName: true; email: true } } };
}>;

/**
 * 一覧に出す形へ。
 * 共有されたものは誰が作ったか分かるようにし、消せるかどうかもここで決めてしまう
 * （画面側で権限判定を書かなくて済むように）。
 */
export function toSavedFilterDto(row: Row, viewerId: string): SavedFilterDto {
  return {
    id: row.id,
    tableKey: row.tableKey,
    title: row.title,
    query: row.query,
    shared: row.shared,
    mine: row.ownerId === viewerId,
    ownerName: row.owner.displayName ?? row.owner.email,
  };
}
