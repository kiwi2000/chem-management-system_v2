/**
 * 突き合わせの結果を、人が読む Markdown と、表計算で開く TSV にする。
 */
import { FIELD_LABELS, type Finding, type Impact, type Proposal, type Report } from "./compare";

const IMPACT_LABEL: Record<Impact, string> = {
  display: "表示だけ",
  judgement: "判定が変わる",
  key: "突き合わせの鍵",
};
const PROPOSAL_LABEL: Record<Proposal, string> = {
  keep: "残す",
  "keep-check": "残す（確認）",
  discuss: "要相談",
};
const CHANGE_LABEL: Record<Finding["change"], string> = {
  added: "追加",
  removed: "削除",
  changed: "変更",
  moved: "付け替え",
};
const KIND_LABEL: Record<Finding["kind"], string> = {
  law: "法律",
  category: "区分",
  class: "分類",
  substance: "法文物質名",
  link: "結び付き",
};
const CONFLICT_LABEL: Record<Finding["conflict"], string> = {
  absent: "配布物に無い（そのまま残る）",
  agree: "配布物と同じ",
  conflict: "配布物とぶつかる",
  "n/a": "",
};

const place = (f: Finding) => [f.law, f.category, f.class].filter(Boolean).join(" › ") || "";

const fieldLabel = (f: Finding) =>
  f.field === "" ? "" : f.field === "class" ? "分類" : (FIELD_LABELS[f.field] ?? f.field);

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 120);

function table(rows: Finding[], hasNext: boolean): string {
  const head = [
    "種類",
    "場所",
    "法文物質名 / CAS",
    "変更",
    "項目",
    "顧客",
    "当方",
    ...(hasNext ? ["配布物", "配布物との関係"] : []),
    "備考",
  ];
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const f of rows) {
    const target = [f.substance ? `${f.substance} ${f.name}` : f.name, f.cas]
      .filter(Boolean)
      .join(" / ");
    const cols = [
      KIND_LABEL[f.kind],
      cell(place(f)),
      cell(target),
      CHANGE_LABEL[f.change],
      fieldLabel(f),
      cell(f.customer),
      cell(f.base),
      ...(hasNext ? [cell(f.next), CONFLICT_LABEL[f.conflict]] : []),
      cell(f.remark),
    ];
    lines.push(`| ${cols.join(" | ")} |`);
  }
  return lines.join("\n");
}

/** Markdown の報告。長い一覧は上限で切り、全件は TSV に任せる */
export function toMarkdown(r: Report, limitPerSection = 300): string {
  const { counts, total, hasNext } = r.summary;
  const impacts: Impact[] = ["discuss" as never, "judgement", "display", "key"].filter(
    (x): x is Impact => x === "judgement" || x === "display" || x === "key",
  );
  const sum = (imp: Impact) => counts[imp].keep + counts[imp]["keep-check"] + counts[imp].discuss;

  const out: string[] = [];
  out.push(`# 事前チェック: ${r.customerLabel}`);
  out.push("");
  out.push(`- 顧客の写し: ${r.customerLabel}`);
  out.push(`- 当方の正規データ: ${r.baseLabel}`);
  out.push(`- 次の配布物: ${r.nextLabel ?? "（指定なし。配布物との関係は見ていない）"}`);
  out.push(`- 顧客の変更: ${total} 件`);
  out.push("");
  out.push("## まとめ");
  out.push("");
  out.push("| 影響 | 残す | 残す（確認） | 要相談 | 計 |");
  out.push("| --- | ---: | ---: | ---: | ---: |");
  for (const imp of impacts) {
    out.push(
      `| ${IMPACT_LABEL[imp]} | ${counts[imp].keep} | ${counts[imp]["keep-check"]} | ${counts[imp].discuss} | ${sum(imp)} |`,
    );
  }
  out.push("");
  out.push(
    "扱いの案: **残す** は顧客のものを残してそのまま取り込める。**残す（確認）** は判定に効くので人が一度見る。**要相談** は配布物とぶつかる、または突き合わせの鍵が変わるので顧客と決める。",
  );
  out.push("");

  const sections: { title: string; pick: (f: Finding) => boolean }[] = [
    { title: "要相談", pick: (f) => f.proposal === "discuss" },
    { title: "判定が変わる（残す・確認）", pick: (f) => f.proposal === "keep-check" },
    { title: "表示だけ・そのまま残す", pick: (f) => f.proposal === "keep" },
  ];
  for (const s of sections) {
    const rows = r.findings.filter(s.pick);
    out.push(`## ${s.title}（${rows.length} 件）`);
    out.push("");
    if (rows.length === 0) {
      out.push("なし");
    } else {
      out.push(table(rows.slice(0, limitPerSection), hasNext));
      if (rows.length > limitPerSection)
        out.push("", `（先頭 ${limitPerSection} 件だけ。全件は TSV を見る）`);
    }
    out.push("");
  }
  return out.join("\n");
}

/** 全件の TSV。表計算で絞り込むためのもの */
export function toTsv(r: Report): string {
  const head = [
    "種類",
    "法律",
    "区分",
    "分類",
    "法文物質名",
    "名前",
    "CAS",
    "変更",
    "項目",
    "顧客",
    "当方",
    "配布物",
    "影響",
    "配布物との関係",
    "扱いの案",
    "備考",
  ];
  const esc = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  const lines = [head.join("\t")];
  for (const f of r.findings) {
    lines.push(
      [
        KIND_LABEL[f.kind],
        f.law,
        f.category,
        f.class,
        f.substance,
        esc(f.name),
        f.cas,
        CHANGE_LABEL[f.change],
        fieldLabel(f),
        esc(f.customer),
        esc(f.base),
        esc(f.next),
        IMPACT_LABEL[f.impact],
        CONFLICT_LABEL[f.conflict],
        PROPOSAL_LABEL[f.proposal],
        esc(f.remark),
      ].join("\t"),
    );
  }
  return lines.join("\n") + "\n";
}
