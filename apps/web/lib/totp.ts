import { createHmac, randomBytes } from "node:crypto";

/**
 * TOTP（RFC 6238）の最小実装。多要素認証（MFA）用。
 * Google Authenticator / Microsoft Authenticator 等と互換。
 * 外部サービス・外部通信は一切使わない（完全閉域運用のため）。
 */

const DIGITS = 6;
const PERIOD = 30; // 秒
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32エンコード（RFC 4648・認証アプリ登録用） */
function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** MFA用の秘密鍵を生成（Base32文字列） */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** 認証アプリに読み込ませる otpauth URI（QRコード化して使う） */
export function totpUri(secret: string, account: string, issuer = "化学物質管理システム"): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(account)}?secret=${secret}&issuer=${enc(issuer)}&digits=${DIGITS}&period=${PERIOD}`;
}

/** 指定時刻のコードを算出 */
function codeAt(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const bin =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * コード検証。時計ずれを考慮して前後1ステップ（±30秒）まで許容する。
 */
export function verifyTotp(secret: string, token: string): boolean {
  const t = token.trim();
  if (!/^\d{6}$/.test(t)) return false;
  const counter = Math.floor(Date.now() / 1000 / PERIOD);
  for (const drift of [-1, 0, 1]) {
    if (codeAt(secret, counter + drift) === t) return true;
  }
  return false;
}
