/**
 * 法文物質名の「番号」を作る。
 *
 * **番号には出典を含める。**
 * 1つの規制区分の物質が、法律・政令・省令の**別々の表**から来ることが普通にあり、
 * 表ごとに1から番号が振られるので、番号だけでは区別できない
 * （`docs/法規制データの作り方.md` 第0-3章）。
 *
 * ```
 * 毒劇法 毒物   法別表第1の1     法の別表第一の1号
 *              令第1条第1号     毒物及び劇物指定令 第1条の1号
 * 安衛法 表示   則別表第2の1552  安衛則 別表第2の1552項
 *              令別表第9の1     施行令 別表第九の1号
 *              令別表第3第1号の1 施行令 別表第三第一号の1
 * ```
 *
 * 書き方は NITE の CHRIP に合わせている（あちらも `政令第1条第1号` の形）。
 *
 * **日本の法令だけに使う。**中国の序号・EU の Index No・米国の CAS は
 * それ自体で一意なので、そのまま持つ。
 */

/** 出典の種類。**これが番号の頭に出る** */
export type SourceKind =
  /** 法律の別表。`法別表第1の1` */
  | "lawTable"
  /** 政令の条。`令第1条第1号` */
  | "orderArticle"
  /** 政令の別表。`令別表第1の1` */
  | "orderTable"
  /** 政令の別表の、号の下の細目。`令別表第3第1号の6` */
  | "orderTableItem"
  /** 政令の別表の項と欄。`令別表第1項第3欄(1)`。化学兵器禁止法は項で区分、欄で毒性物質と原料物質を分ける */
  | "orderTableColumn"
  /** 省令の別表。`則別表第2の1552` */
  | "ordinanceTable"
  /** 出典が1つしかなく、番号をそのまま使うもの（官報公示整理番号など） */
  | "plain";

export interface NumberSpec {
  kind: SourceKind;
  /** 別表の番号（`1` `6の2` `9`）、または条の番号（`1` `3の3` `16`） */
  table?: string;
  /** 政令の別表で、号の下に細目があるときの号（`1` `2` `3`） */
  item?: string;
  /** 条の中の項（安衛法の製造禁止は「第16条第1項」）、または別表の項（化学兵器禁止法の `一の項`） */
  paragraph?: string;
}

/**
 * 出典と枝番から、表示にも突合にも使う番号を作る。
 *
 * **ここで作った文字列がそのまま `official_number` になる。**
 * LOLI との突合も、LOLI 側の鍵をこの形に組み立ててから当てる
 */
export function statutoryNumber(spec: NumberSpec, num: string): string {
  const n = num.trim();
  switch (spec.kind) {
    case "lawTable":
      return `法別表第${spec.table}の${n}`;
    case "orderArticle":
      return spec.paragraph
        ? `令第${spec.table}条第${spec.paragraph}項第${n}号`
        : `令第${spec.table}条第${n}号`;
    case "orderTable":
      return `令別表第${spec.table}の${n}`;
    case "orderTableItem":
      return `令別表第${spec.table}第${spec.item}号の${n}`;
    case "orderTableColumn":
      /*
        項を書かないと番号が一意にならない。化学兵器禁止法の別表は
        一の項＝特定物質・二の項＝第1種指定物質・三の項＝第2種指定物質で、
        **どの項にも第三欄(1)・第四欄(1)がある**
      */
      return spec.paragraph
        ? `令別表第${spec.paragraph}項第${spec.table}欄(${n})`
        : `令別表第${spec.table}欄(${n})`;
    case "ordinanceTable":
      return `則別表第${spec.table}の${n}`;
    case "plain":
      return n;
  }
}

/** 番号から枝番だけを取り出す。照合や見直しに使う。取り出せなければ null */
export function bareNumber(official: string): string | null {
  const m = /の([^のはを]+)$|第([^第]+)号$/.exec(official.trim());
  if (!m) return null;
  return (m[1] ?? m[2] ?? null)?.trim() ?? null;
}
