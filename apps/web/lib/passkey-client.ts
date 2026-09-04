"use client";

import {
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";

/**
 * ブラウザ側のパスキーの呼び出し。
 *
 * **やめたときと、失敗したときを分ける。**利用者が指紋の画面で「キャンセル」を
 * 押しただけなのに赤い文字で「失敗しました」と出すと、何か壊れたように見える。
 */

export type PasskeyOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "cancelled" | "unsupported" | "already" | "timeout" | "failed" };

/**
 * 端末の返事をいつまで待つか。サーバーが出すお題の期限（60秒）より少し長くして、
 * 本来はブラウザ側の時間切れが先に来るようにしてある。
 *
 * Windows の「Windows セキュリティ」の窓が別の画面や他の窓の後ろに出てしまい、
 * ブラウザからの返事が来ないまま「確認中...」で止まったことがあった（Edge）。
 * 待ちきれなかったら、こちらで打ち切ってボタンを戻し、何を確かめればよいかを伝える
 */
const DEADLINE_MS = 90_000;

/** 端末の返事を期限付きで待つ。期限が来たら進行中のやりとりを取り消す */
async function withDeadline<T>(run: () => Promise<T>): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      WebAuthnAbortService.cancelCeremony();
      resolve("timeout");
    }, DEADLINE_MS);
  });
  try {
    return await Promise.race([run(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * サーバーにお題を取りに行くときの期限。通信を検査するセキュリティ製品が応答を
 * 止めてしまうと、窓が出ないまま「確認中...」で止まる。そのときは打ち切って伝える
 */
export const OPTIONS_FETCH_MS = 30_000;

/** お題を取りに行く。返事が来なければ null（呼び手は「サーバーからの返事が無い」と出す） */
export async function fetchPasskeyOptions(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { method: "POST", signal: AbortSignal.timeout(OPTIONS_FETCH_MS) });
  } catch {
    return null;
  }
}

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
    const value = await withDeadline(() =>
      startRegistration({
        optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"],
      }),
    );
    if (value === "timeout") return { ok: false, reason: "timeout" };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, reason: classify(e) };
  }
}

/** ログイン。端末が「誰の鍵か」を選んで署名する */
export async function signWithPasskey(options: unknown): Promise<PasskeyOutcome<unknown>> {
  if (!passkeySupported()) return { ok: false, reason: "unsupported" };
  try {
    const value = await withDeadline(() =>
      startAuthentication({
        optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
      }),
    );
    if (value === "timeout") return { ok: false, reason: "timeout" };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, reason: classify(e) };
  }
}
