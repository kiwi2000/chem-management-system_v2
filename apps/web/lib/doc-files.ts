import { buildDocFileName, type DocFileNameVars } from "@chem/shared";
import JSZip from "jszip";
import { constants, existsSync } from "node:fs";
import { access, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getAppSettings } from "@/lib/settings";

/**
 * 帳票の PDF ファイルの置き場所と名前（2026-09-16 指示）。
 *
 * フォルダーはシステム設定「帳票の出力先」。**相対の道筋はアプリのフォルダー（起動した場所）から数える。**
 * 外からは直接見えず、取り出しは API（持ち主の確認つき）を通す。
 */

/**
 * アプリのフォルダー（導入先。C:\chem や /app）。
 * 起動時の作業フォルダーは apps/web になることがある（`npm run start -w apps/web`）ので、
 * prisma/ のある親まで上がる。見つからなければ作業フォルダーそのもの
 */
export function appRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, "prisma", "schema.prisma"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

/** 設定の道筋を絶対にする。相対ならアプリのフォルダーから */
export function resolveOutputDir(setting: string): string {
  const s = setting.trim();
  return isAbsolute(s) ? s : resolve(appRoot(), s);
}

/** フォルダーを作って、書けるかを確かめる。だめなら理由（例外）を投げる */
export async function ensureWritableDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await access(dir, constants.W_OK);
}

/** いま設定されている出力先（絶対の道筋）。無ければ作る */
export async function currentOutputDir(): Promise<string> {
  const settings = await getAppSettings();
  const dir = resolveOutputDir(settings.documentOutputDir);
  await ensureWritableDir(dir);
  return dir;
}

/** 同じ名前があれば -2, -3 … と付けて避ける */
export async function uniquePath(dir: string, base: string, ext: string): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const name = n === 1 ? `${base}${ext}` : `${base}-${n}${ext}`;
    const p = join(dir, name);
    try {
      await stat(p);
    } catch {
      return p;
    }
  }
  throw new Error(`too many files named ${base}${ext}`);
}

/**
 * PDF を書き、落とすときの名前とサーバー上の道筋・大きさを返す
 */
export async function writePdfFile(
  dir: string,
  pattern: string,
  vars: DocFileNameVars,
  pdf: Buffer,
): Promise<{ fileName: string; filePath: string; fileSize: number }> {
  const base = buildDocFileName(pattern, vars);
  const filePath = await uniquePath(dir, base, ".pdf");
  await writeFile(filePath, pdf);
  return { fileName: filePath.slice(dir.length + 1), filePath, fileSize: pdf.byteLength };
}

/** ファイルを消す。もう無ければ何もしない（記録を消すときに呼ぶ） */
export async function removeFile(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  await unlink(filePath).catch(() => undefined);
}

/** ファイルがまだあるか */
export async function fileExists(filePath: string | null | undefined): Promise<boolean> {
  if (!filePath) return false;
  return stat(filePath)
    .then((s) => s.isFile())
    .catch(() => false);
}

/**
 * 複数の PDF を 1 つの zip に。**同じ名前が重なったら連番を付ける**（別の日に作った同名の帳票など）。
 * 無くなっているファイルは飛ばす（何を飛ばしたかは呼び出し側が数える）
 */
export async function zipFiles(
  files: { fileName: string; filePath: string }[],
): Promise<{ zip: Buffer; added: number; missing: number }> {
  const zip = new JSZip();
  const used = new Set<string>();
  let added = 0;
  let missing = 0;
  for (const f of files) {
    let data: Buffer;
    try {
      data = await readFile(f.filePath);
    } catch {
      missing++;
      continue;
    }
    let name = f.fileName;
    for (let n = 2; used.has(name); n++) {
      name = f.fileName.replace(/(\.pdf)$/i, `-${n}$1`);
    }
    used.add(name);
    zip.file(name, data);
    added++;
  }
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zip: out, added, missing };
}

/** ダウンロードの応答。名前は UTF-8 で付ける（日本語のファイル名がそのまま出る） */
export function fileResponse(body: Buffer, fileName: string, contentType: string): Response {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
