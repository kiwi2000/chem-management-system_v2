"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

/**
 * ブラウザ側のパスキーの呼び出し。
 *
 * **やめたときと、失敗したときを分ける。**利用者が指紋の画面で「キャンセル」を
 * 押しただけなのに赤い文字で「失敗しました」と出すと、何か壊れたように見える。
 */

export type PasskeyOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "cancelled" | "unsupported" | "already" | "failed" };

/** この端末でパスキーを使えるか */
export function passkeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials?.create === "function"
  );
}

/*
  端末が投げてくる名前で見分ける。
  NotAllowedError … 利用者がやめた、または時間切れ
  InvalidStateError … その端末はもう登録済み（登録のときだけ出る）
*/
function classify(e: unknown): "cancelled" | "unsupported" | "already" | "failed" {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "cancelled";
  if (name === "NotSupportedError") return "unsupported";
  // 同じ端末の鍵がもうある。別のブラウザから登録した鍵も、同じPCなら同じ鍵
  if (name === "InvalidStateError") return "already";
  return "failed";
}

/** 登録。サーバーが出したお題に、端末が署名して返す */
export async function createPasskey(options: unknown): Promise<PasskeyOutcome<unknown>> {
  if (!passkeySupported()) return { ok: false, reason: "unsupported" };
  try {
    const value = await startRegistration({
      optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"],
    });
    return { ok: true, value };
  } catch (e) {
    return { ok: false, reason: classify(e) };
  }
}

/** ログイン。端末が「誰の鍵か」を選んで署名する */
export async function signWithPasskey(options: unknown): Promise<PasskeyOutcome<unknown>> {
  if (!passkeySupported()) return { ok: false, reason: "unsupported" };
  try {
    const value = await startAuthentication({
      optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
    });
    return { ok: true, value };
  } catch (e) {
    return { ok: false, reason: classify(e) };
  }
}
