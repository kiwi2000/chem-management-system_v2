/**
 * 接続元のおよその国を判定するための表を作る管理用スクリプト。
 *
 * 実行:
 *   npx tsx scripts/build-ip-country.ts
 *
 * 元データは、世界の5つのIPアドレス管理団体（RIR）が公開している割り当て表。
 * **無料で、登録も要らない。**外部の会社にこちらのアドレスを送らずに済むよう、
 * 手元に表を持つ方式にしている。
 *
 * ここで分かるのは「そのアドレスが、どの国の団体に割り当てられているか」であって、
 * 使っている人が今どこにいるかではない。海外の事業者を経由すればその国に見える。
 * **「見慣れない国から入られていないか」に気づくためのもの**と割り切る。
 *
 * 作った表は apps/web/data/ip-country.bin に置く。年に1〜2回作り直せば足りる。
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 元データの置き場。
 * 1つの団体につき複数の場所を並べてある。上から順に試し、取れたところで次へ進む
 * （相手は世界中の団体なので、片方が落ちていることがある。実際に起きた）。
 */
const SOURCES: string[][] = [
  ["https://ftp.apnic.net/stats/apnic/delegated-apnic-latest"],
  ["https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-latest"],
  // ARIN は「extended」の名前でしか置いていない（中身の形式は同じ）
  ["https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest"],
  [
    "https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-latest",
    // 本家が繋がらないことがあるので、RIPE が持っている控えも見る
    "https://ftp.ripe.net/pub/stats/afrinic/delegated-afrinic-latest",
  ],
  ["https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-latest"],
];

interface V4 {
  start: number;
  count: number;
  cc: string;
}
interface V6 {
  hi: bigint;
  len: number;
  cc: string;
}

const v4: V4[] = [];
const v6: V6[] = [];
/** 取れなかった元データ。最後にまとめて知らせる */
const missing: string[] = [];

/** 何度か試す。相手は世界中の団体なので、たまに繋がらない */
async function download(url: string, tries = 3): Promise<string | null> {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (res.ok) return await res.text();
    } catch {
      // 次で試す
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

function toV4(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let v = 0;
  for (const s of p) {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    v = v * 256 + n;
  }
  return v;
}

/** IPv6 の上位64ビットだけ見る。国の割り当ては /48 より粗いので、これで足りる */
function toV6Hi(prefix: string): bigint | null {
  const parts = prefix.split("::");
  if (parts.length > 2) return null;
  const head = (parts[0] ?? "").split(":").filter((s) => s.length > 0);
  const tail = (parts[1] ?? "").split(":").filter((s) => s.length > 0);
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(parts.length === 2 ? fill : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  let hi = 0n;
  for (let i = 0; i < 4; i += 1) {
    const n = parseInt(groups[i] as string, 16);
    if (!Number.isInteger(n)) return null;
    hi = (hi << 16n) | BigInt(n);
  }
  return hi;
}

async function main() {
  for (const urls of SOURCES) {
    process.stdout.write(`取得中: ${(urls[0] as string).split("/").pop()} ... `);
    let text: string | null = null;
    for (const url of urls) {
      text = await download(url);
      if (text !== null) break;
    }
    if (text === null) {
      // 1つ欠けても表は作れるが、その地域の判定ができなくなる。黙って進めない
      missing.push(urls[0] as string);
      console.log("取得できませんでした");
      continue;
    }
    let n = 0;
    for (const line of text.split("\n")) {
      if (line.startsWith("#") || line.length === 0) continue;
      const f = line.split("|");
      // registry|cc|type|start|value|date|status
      const [, cc, type, start, value, , status] = f;
      if (!cc || cc === "*" || cc.length !== 2) continue;
      if (status !== "allocated" && status !== "assigned") continue;
      if (type === "ipv4") {
        const s = toV4(start ?? "");
        const c = Number(value);
        if (s === null || !Number.isInteger(c) || c <= 0) continue;
        v4.push({ start: s, count: c, cc });
        n += 1;
      } else if (type === "ipv6") {
        const hi = toV6Hi(start ?? "");
        const len = Number(value);
        if (hi === null || !Number.isInteger(len) || len < 1 || len > 64) continue;
        v6.push({ hi, len, cc });
        n += 1;
      }
    }
    console.log(`${n}件`);
  }

  // 並べてから、隣り合う同じ国をつなぐ。表が小さくなり、探すのも速くなる
  v4.sort((a, b) => a.start - b.start);
  const mergedV4: V4[] = [];
  for (const r of v4) {
    const last = mergedV4[mergedV4.length - 1];
    if (last && last.cc === r.cc && last.start + last.count === r.start) {
      last.count += r.count;
    } else {
      mergedV4.push({ ...r });
    }
  }
  v6.sort((a, b) => (a.hi < b.hi ? -1 : a.hi > b.hi ? 1 : 0));

  const codes = [...new Set([...mergedV4.map((r) => r.cc), ...v6.map((r) => r.cc)])].sort();
  const indexOf = new Map(codes.map((c, i) => [c, i]));

  /*
    形式（すべて little endian）:
      "IPC1" | 国の数 u16 | 国コード 2バイト × 数
      IPv4の数 u32 | (開始 u32, 終わり u32, 国 u16) × 数
      IPv6の数 u32 | (上位64ビット u32×2, 長さ u8, 国 u16) × 数
  */
  const size = 4 + 2 + codes.length * 2 + 4 + mergedV4.length * 10 + 4 + v6.length * 11;
  const buf = Buffer.alloc(size);
  let o = 0;
  buf.write("IPC1", o, "ascii");
  o += 4;
  buf.writeUInt16LE(codes.length, o);
  o += 2;
  for (const c of codes) {
    buf.write(c, o, "ascii");
    o += 2;
  }
  buf.writeUInt32LE(mergedV4.length, o);
  o += 4;
  for (const r of mergedV4) {
    buf.writeUInt32LE(r.start, o);
    o += 4;
    // 終わりは「含む」。開始＋個数−1
    buf.writeUInt32LE(r.start + r.count - 1, o);
    o += 4;
    buf.writeUInt16LE(indexOf.get(r.cc) as number, o);
    o += 2;
  }
  buf.writeUInt32LE(v6.length, o);
  o += 4;
  for (const r of v6) {
    buf.writeUInt32LE(Number((r.hi >> 32n) & 0xffffffffn), o);
    o += 4;
    buf.writeUInt32LE(Number(r.hi & 0xffffffffn), o);
    o += 4;
    buf.writeUInt8(r.len, o);
    o += 1;
    buf.writeUInt16LE(indexOf.get(r.cc) as number, o);
    o += 2;
  }

  if (missing.length > 0) {
    console.log(`
取得できなかった元データ（その地域の判定ができません）:`);
    for (const u of missing) console.log(`  ${u}`);
    console.log("  → 時間をおいて実行し直してください");
  }

  const out = resolve(process.cwd(), "apps/web/data/ip-country.bin");
  writeFileSync(out, buf);
  console.log(
    `\n書きました: ${out}\n` +
      `  国 ${codes.length} / IPv4 ${mergedV4.length}件（つなぐ前 ${v4.length}件）/ IPv6 ${v6.length}件\n` +
      `  大きさ ${(size / 1024 / 1024).toFixed(2)} MB`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
