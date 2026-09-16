import type { AppSettings } from "@chem/shared";
import sharp from "sharp";

/**
 * 画像ライブラリに入れる前の整えかた（2026-09-16 指示）。
 *
 * システム設定に従って、**長辺を上限まで縮め、形式を PNG / JPEG にそろえる**。
 * 画面（ブラウザ）でも印刷（Chromium で作る PDF）でも、そのまま扱える 2 つの形式だけにする
 * （将来 Word・Excel に出すときも、この 2 つならそのまま埋め込める）。
 * 縮めるだけで、小さい画像は引き伸ばさない。一覧用の小さな絵（長辺 200px）も一緒に作る
 */

/** 受け付ける元の形式（sharp が読めて、ふつうに使われるもの） */
export const IMAGE_INPUT_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

/** 元のファイルの上限。整えたあとはずっと小さくなる */
export const IMAGE_UPLOAD_MAX = 20 * 1024 * 1024;

const THUMB_EDGE = 200;

export interface ProcessedImage {
  data: Buffer;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  thumb: Buffer;
}

/**
 * 元の画像を整える。読めない・壊れていれば例外
 */
export async function processImage(
  input: Buffer,
  settings: Pick<AppSettings, "imageMaxEdgePx" | "imageFormat" | "imageJpegQuality">,
): Promise<ProcessedImage> {
  // 向きの情報（EXIF）を反映してから扱う。アニメーションは 1 コマ目だけ
  const base = sharp(input, { animated: false }).rotate();
  const meta = await base.metadata();
  const srcFormat = meta.format ?? "";

  // 形式を決める。keep は PNG / JPEG のまま、それ以外は PNG に（透明を落とさない）
  const toJpeg =
    settings.imageFormat === "jpeg" || (settings.imageFormat === "keep" && srcFormat === "jpeg");
  const mime = toJpeg ? "image/jpeg" : "image/png";

  const resized = base.resize({
    width: settings.imageMaxEdgePx,
    height: settings.imageMaxEdgePx,
    fit: "inside",
    withoutEnlargement: true,
  });
  const main = toJpeg
    ? // 透明な部分は白にする（JPEG は透明を持てない）
      resized.flatten({ background: "#ffffff" }).jpeg({ quality: settings.imageJpegQuality })
    : resized.png({ compressionLevel: 9 });
  const { data, info } = await main.toBuffer({ resolveWithObject: true });

  const thumb = await sharp(data)
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { data, mime, width: info.width, height: info.height, thumb };
}
