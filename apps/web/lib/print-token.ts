import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 印刷用ページ（/print/<帳票id>）を開くための短命の印。
 *
 * PDF を作るサーバー側のブラウザは、ログインの Cookie を持たない。
 * 代わりに、**帳票の id と期限を署名した印**を URL に付けて開く。
 * 署名の鍵は環境の値から作る（メモリに乱数を置くと、開発時にモジュールが作り直されて食い違う）。
 * 印は 2 分で切れ、その帳票にしか効かない
 */
const TTL_MS = 2 * 60_000;

function secret(): string {
  // 専用の鍵があればそれを、無ければ DB の接続文字列から作る（外に出ない値なら何でもよい）
  const base = process.env.PRINT_TOKEN_SECRET ?? process.env.DATABASE_URL ?? "chem";
  return createHmac("sha256", "chem-print-token").update(base).digest("hex");
}

function sign(docId: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${docId}.${exp}`).digest("base64url");
}

export function makePrintToken(docId: string): string {
  const exp = Date.now() + TTL_MS;
  return `${exp}.${sign(docId, exp)}`;
}

export function verifyPrintToken(docId: string, token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(docId, exp));
  return given.length === want.length && timingSafeEqual(given, want);
}
