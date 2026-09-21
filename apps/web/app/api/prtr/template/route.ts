import ExcelJS from "exceljs";
import { requirePermission } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * GET /api/prtr/template — 取り込み用のテンプレート（Excel）を返す（S22）。
 *
 * **全部の形をシートに分けて 1 つのファイルにまとめる**（製品ごとの数量、実測値）。
 * 各シートの 1 行目が見出しで、取り込みの列の割り当てにそのまま当たる名前にしてある。
 * 所属によらない（誰が落としても同じ物）ので、所属の確認は要らない
 */
export async function GET() {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const t = m.prtr;

  const sheets: { name: string; columns: { header: string; width: number }[] }[] = [
    {
      name: t.import.kinds.quantities,
      columns: [
        { header: t.quantities.productCode, width: 20 },
        { header: t.quantities.productName, width: 40 },
        { header: `${t.quantities.purchasedKg}(kg)`, width: 16 },
        { header: `${t.quantities.shippedKg}(kg)`, width: 16 },
      ],
    },
    {
      name: t.import.kinds.measured,
      columns: [
        { header: t.measured.substanceCode, width: 20 },
        { header: t.measured.substanceName, width: 40 },
        { header: `${t.measured.measuredKg}(kg)`, width: 16 },
      ],
    },
  ];

  const wb = new ExcelJS.Workbook();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name);
    ws.columns = sh.columns.map((c) => ({ header: c.header, width: c.width }));
    ws.getRow(1).font = { bold: true };
  }
  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  const fileName = `${t.import.templateFile}.xlsx`;
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
