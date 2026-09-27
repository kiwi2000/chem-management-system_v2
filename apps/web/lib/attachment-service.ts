import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MACRO_EXTENSIONS,
  fileExtension,
  isPreviewable,
  type AppSettings,
} from "@chem/shared";
import JSZip from "jszip";
import type { Actor } from "@/lib/authz";
import { canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { canEditProduct, visibilityWhere } from "@/lib/product-service";
import type { ProductAttachmentDto } from "@/lib/types";

/**
 * 製品・原材料の添付ファイル（2026-09-27 指示）。
 *
 * - **見られるのは、その製品を見られて、かつ組成を見られる人（COMPOSITION_VIEW）だけ。**
 *   主な添付は原材料の SDS で組成が書かれているため。組成を見られない人には欄ごと出さない
 * - 追加・削除・書き換えは、その製品を編集でき、かつ組成を見られる人
 * - 中身は DB に置く。一覧は中身を読まずに引く
 */

/** 拡張子ごとの形式と、中身の頭の印（拡張子だけ変えた別物を受け取らないため） */
const FORMATS: Partial<
  Record<
    (typeof ATTACHMENT_EXTENSIONS)[number] | (typeof ATTACHMENT_MACRO_EXTENSIONS)[number],
    { mime: string; magic: number[][] }
  >
> = {
  // マクロ付き。システム設定で許したときだけ受け付ける
  docm: {
    mime: "application/vnd.ms-word.document.macroEnabled.12",
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  xlsm: {
    mime: "application/vnd.ms-excel.sheet.macroEnabled.12",
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  pdf: { mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
  doc: { mime: "application/msword", magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  xls: { mime: "application/vnd.ms-excel", magic: [[0xd0, 0xcf, 0x11, 0xe0]] },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    magic: [[0x50, 0x4b, 0x03, 0x04]],
  },
  csv: { mime: "text/csv", magic: [] },
  txt: { mime: "text/plain", magic: [] },
  png: { mime: "image/png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: "image/jpeg", magic: [[0xff, 0xd8, 0xff]] },
  gif: { mime: "image/gif", magic: [[0x47, 0x49, 0x46, 0x38]] },
  webp: { mime: "image/webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  bmp: { mime: "image/bmp", magic: [[0x42, 0x4d]] },
  tif: {
    mime: "image/tiff",
    magic: [
      [0x49, 0x49, 0x2a, 0x00],
      [0x4d, 0x4d, 0x00, 0x2a],
    ],
  },
  tiff: {
    mime: "image/tiff",
    magic: [
      [0x49, 0x49, 0x2a, 0x00],
      [0x4d, 0x4d, 0x00, 0x2a],
    ],
  },
};

export type AttachmentReject = "tooLarge" | "badType" | "mismatch" | "macro" | "empty";

/**
 * 受け取ってよいファイルか。よければ形式（MIME）を返す。
 * **断る理由は 1 つだけ返す。**直しかたが分かればよい
 */
export async function inspectAttachment(
  name: string,
  buf: Buffer,
  /** システム設定の上限（MB）、マクロ付きを受け付けるか、受け付ける拡張子（2026-09-27 指示） */
  policy: Pick<AppSettings, "attachmentMaxMb" | "attachmentAllowMacros" | "attachmentExtensions">,
): Promise<{ ok: true; mime: string } | { ok: false; reason: AttachmentReject }> {
  if (buf.length === 0) return { ok: false, reason: "empty" };
  if (buf.length > policy.attachmentMaxMb * 1024 * 1024) return { ok: false, reason: "tooLarge" };
  const ext = fileExtension(name);
  // 受け付ける拡張子。**空ならすべて受け付ける**
  if (policy.attachmentExtensions.length > 0 && !policy.attachmentExtensions.includes(ext)) {
    return { ok: false, reason: "badType" };
  }
  // マクロ付きの拡張子は、受け付ける拡張子に挙がっていても、マクロを許していなければ断る
  const macroExt = (ATTACHMENT_MACRO_EXTENSIONS as readonly string[]).includes(ext);
  if (macroExt && !policy.attachmentAllowMacros) return { ok: false, reason: "macro" };
  /*
    知っている形式は、中身の頭の印が拡張子と合うかを見る（拡張子だけ変えた別物を受け取らない）。
    知らない形式（設定で足した拡張子）は中身を見ずに受け取り、落とすときは
    「ただのバイト列」として渡す（ブラウザに中身を解釈させない）
  */
  const format: { mime: string; magic: number[][] } | undefined =
    FORMATS[ext as keyof typeof FORMATS];
  if (!format) return { ok: true, mime: "application/octet-stream" };
  if (format.magic.length > 0 && !format.magic.some((m) => m.every((b, i) => buf[i] === b))) {
    return { ok: false, reason: "mismatch" };
  }
  // マクロを許しているなら、マクロの有無は調べない（拡張子と頭の印だけ）
  if (policy.attachmentAllowMacros) return { ok: true, mime: format.mime };
  // Office の新しい形式（zip）。マクロの本体（vbaProject.bin）が入っていたら断る
  if (ext === "docx" || ext === "xlsx") {
    try {
      const zip = await JSZip.loadAsync(buf);
      if (Object.keys(zip.files).some((n) => n.toLowerCase().endsWith("vbaproject.bin"))) {
        return { ok: false, reason: "macro" };
      }
    } catch {
      return { ok: false, reason: "mismatch" };
    }
  }
  // Office の古い形式。マクロは「_VBA_PROJECT」という名の中身として入っている（名前は UTF-16）
  if (ext === "doc" || ext === "xls") {
    if (buf.includes(Buffer.from("_VBA_PROJECT", "utf16le"))) return { ok: false, reason: "macro" };
  }
  return { ok: true, mime: format.mime };
}

/** プレビューできる形式か（本体は shared。API から読みやすいようここからも出す） */
export { isPreviewable };

/**
 * 添付を見てよいか。**製品が見えて、組成を見られること**
 */
export function canViewAttachments(
  actor: Actor,
  product: Parameters<typeof canViewComposition>[1],
): boolean {
  return canViewComposition(actor, product);
}

/** 添付を足す・消す・直してよいか。製品を編集でき、かつ組成を見られること */
export function canEditAttachments(
  actor: Actor,
  product: Parameters<typeof canViewComposition>[1],
): boolean {
  return canEditProduct(actor, product) && canViewComposition(actor, product);
}

/** その人が見られる製品（非公開の製品は、権限が無ければ null） */
export async function visibleProduct(actor: Actor, productId: string) {
  return prisma.product.findFirst({
    where: { id: productId, deletedAt: null, ...visibilityWhere(actor) },
  });
}

/** 一覧に出す項目（中身は読まない） */
export const ATTACHMENT_SELECT = {
  id: true,
  title: true,
  kind: true,
  description: true,
  fileName: true,
  mime: true,
  size: true,
  createdAt: true,
  createdBy: true,
} as const;

type AttachmentRow = {
  id: string;
  title: string;
  kind: string | null;
  description: string | null;
  fileName: string;
  mime: string;
  size: number;
  createdAt: Date;
  createdBy: string | null;
};

/** 登録した人の名前を引いて DTO にする */
export async function toAttachmentDtos(rows: AttachmentRow[]): Promise<ProductAttachmentDto[]> {
  const ids = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => Boolean(x)))];
  const users =
    ids.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayName: true, email: true },
        })
      : [];
  const nameOf = new Map(users.map((u) => [u.id, u.displayName ?? u.email]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    description: r.description,
    fileName: r.fileName,
    mime: r.mime,
    size: r.size,
    createdAt: r.createdAt.toISOString(),
    createdByName: r.createdBy ? (nameOf.get(r.createdBy) ?? null) : null,
  }));
}
