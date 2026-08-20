/**
 * 入力欄の下に出す誤りの説明。
 * 誤りが無いときは何も出さず、余白も作らない（画面が動かないように）。
 */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-destructive text-xs">{message}</p>;
}
