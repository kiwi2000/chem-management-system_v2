/**
 * 紙の向き。
 *
 * **`@page` は CSS でしか指定できない。**要素の style には書けないので、
 * テンプレートごとに違う向きを出すには、その場でスタイルを差し込むしかない。
 */
export function PrintOrientation({ orientation }: { orientation: "portrait" | "landscape" }) {
  return <style>{`@page { size: A4 ${orientation}; margin: 15mm; }`}</style>;
}
