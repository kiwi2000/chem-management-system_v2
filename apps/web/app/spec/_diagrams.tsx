import type { ReactNode } from "react";

/**
 * マニュアルの図。
 *
 * 色は CSS 変数から取る。テーマを切り替えても、その配色のまま描かれるようにするため。
 * 画像ではなく SVG を直接置いているので、拡大しても字がぼやけない。
 */

/** 図の外枠。説明文を下に添える */
function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="border-border space-y-2 border p-3">
      <div className="overflow-x-auto">{children}</div>
      <figcaption className="text-muted-foreground text-xs">{caption}</figcaption>
    </figure>
  );
}

const BOX = { fill: "var(--card)", stroke: "var(--border)" };
const ACCENT = { fill: "var(--secondary)", stroke: "var(--primary)" };
const LABEL = { fill: "var(--foreground)", fontSize: 13 } as const;
const SMALL = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

/** 右向きの矢印。線の先に三角を付ける */
function Arrow({ x1, y, x2, label }: { x1: number; y: number; x2: number; label?: string }) {
  return (
    <>
      <line x1={x1} y1={y} x2={x2 - 7} y2={y} stroke="var(--muted-foreground)" strokeWidth={1.5} />
      <polygon
        points={`${x2},${y} ${x2 - 8},${y - 4} ${x2 - 8},${y + 4}`}
        fill="var(--muted-foreground)"
      />
      {label && (
        <text x={(x1 + x2) / 2} y={y - 8} textAnchor="middle" {...SMALL}>
          {label}
        </text>
      )}
    </>
  );
}

/** 画面がどう分かれているか */
export function ScreenLayoutDiagram() {
  return (
    <Figure caption="左にメニュー、上に自分の情報、中央に選んだ画面の中身が出ます。">
      <svg viewBox="0 0 420 200" width="100%" style={{ maxWidth: 420 }} role="img">
        <title>画面の分かれかた</title>
        <rect x={1} y={1} width={418} height={198} {...BOX} strokeWidth={1.5} />
        <rect x={1} y={1} width={110} height={198} {...BOX} strokeWidth={1.5} />
        <rect x={111} y={1} width={308} height={40} {...ACCENT} strokeWidth={1.5} />
        <text x={56} y={26} textAnchor="middle" {...LABEL}>
          メニュー
        </text>
        <text x={56} y={44} textAnchor="middle" {...SMALL}>
          物質・製品など
        </text>
        <text x={265} y={26} textAnchor="middle" {...LABEL}>
          自分の名前とアバター
        </text>
        <text x={265} y={110} textAnchor="middle" {...LABEL}>
          選んだ画面の中身
        </text>
        <text x={265} y={130} textAnchor="middle" {...SMALL}>
          一覧・詳細・入力欄
        </text>
      </svg>
    </Figure>
  );
}

/** 物質・製品・原材料の関係 */
export function DataModelDiagram() {
  return (
    <Figure caption="製品の中身には、物質を直接入れることも、別の製品を原材料として入れることもできます。">
      <svg viewBox="0 0 460 190" width="100%" style={{ maxWidth: 460 }} role="img">
        <title>製品・物質・原材料の関係</title>

        <rect x={160} y={70} width={140} height={50} {...ACCENT} strokeWidth={1.5} />
        <text x={230} y={92} textAnchor="middle" {...LABEL}>
          製品 接着剤A
        </text>
        <text x={230} y={108} textAnchor="middle" {...SMALL}>
          組成を持つ
        </text>

        <rect x={10} y={10} width={130} height={44} {...BOX} strokeWidth={1.5} />
        <text x={75} y={30} textAnchor="middle" {...LABEL}>
          物質 トルエン
        </text>
        <text x={75} y={45} textAnchor="middle" {...SMALL}>
          108-88-3
        </text>

        <rect x={10} y={136} width={130} height={44} {...BOX} strokeWidth={1.5} />
        <text x={75} y={156} textAnchor="middle" {...LABEL}>
          原材料 樹脂ベース
        </text>
        <text x={75} y={171} textAnchor="middle" {...SMALL}>
          これも製品
        </text>

        <rect x={320} y={136} width={130} height={44} {...BOX} strokeWidth={1.5} />
        <text x={385} y={156} textAnchor="middle" {...LABEL}>
          物質 ポリマーA
        </text>
        <text x={385} y={171} textAnchor="middle" {...SMALL}>
          原材料の中身
        </text>

        <Arrow x1={140} y={32} x2={190} label="30%" />
        <line
          x1={190}
          y1={32}
          x2={190}
          y2={70}
          stroke="var(--muted-foreground)"
          strokeWidth={1.5}
        />
        <Arrow x1={140} y={158} x2={190} label="70%" />
        <line
          x1={190}
          y1={158}
          x2={190}
          y2={120}
          stroke="var(--muted-foreground)"
          strokeWidth={1.5}
        />
        <Arrow x1={140} y={158} x2={320} />
      </svg>
    </Figure>
  );
}

/** 状態の移り変わり */
export function StateFlowDiagram() {
  return (
    <Figure caption="承認が要る設定のときの流れです。要らない設定なら、作成中から「発行する」で直接 公開済 になります。">
      <svg viewBox="0 0 470 170" width="100%" style={{ maxWidth: 470 }} role="img">
        <title>状態の移り変わり</title>

        <rect x={5} y={20} width={100} height={40} {...BOX} strokeWidth={1.5} />
        <text x={55} y={45} textAnchor="middle" {...LABEL}>
          作成中
        </text>

        <rect x={185} y={20} width={100} height={40} {...BOX} strokeWidth={1.5} />
        <text x={235} y={45} textAnchor="middle" {...LABEL}>
          承認待
        </text>

        <rect x={365} y={20} width={100} height={40} {...ACCENT} strokeWidth={1.5} />
        <text x={415} y={45} textAnchor="middle" {...LABEL}>
          公開済
        </text>

        <rect
          x={185}
          y={115}
          width={100}
          height={40}
          fill="var(--destructive)"
          fillOpacity={0.1}
          stroke="var(--destructive)"
          strokeWidth={1.5}
        />
        <text x={235} y={140} textAnchor="middle" fill="var(--destructive)" fontSize={13}>
          却下
        </text>

        <Arrow x1={105} y={40} x2={185} label="承認を申請" />
        <Arrow x1={285} y={40} x2={365} label="承認する" />

        {/* 却下されたら下へ落ち、直すと作成中に戻る */}
        <line
          x1={235}
          y1={60}
          x2={235}
          y2={115}
          stroke="var(--destructive)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <text x={243} y={90} {...SMALL} fill="var(--destructive)">
          却下する
        </text>
        <line
          x1={185}
          y1={135}
          x2={55}
          y2={135}
          stroke="var(--muted-foreground)"
          strokeWidth={1.5}
        />
        <line x1={55} y1={135} x2={55} y2={68} stroke="var(--muted-foreground)" strokeWidth={1.5} />
        <polygon points="55,60 51,68 59,68" fill="var(--muted-foreground)" />
        <text x={120} y={128} textAnchor="middle" {...SMALL}>
          直して保存
        </text>
      </svg>
    </Figure>
  );
}

/** 新規登録の3段 */
export function WizardDiagram() {
  return (
    <Figure caption="1段目で「次へ」を押した時点で、作成中として登録されます。途中でやめても続きから再開できます。">
      <svg viewBox="0 0 460 110" width="100%" style={{ maxWidth: 460 }} role="img">
        <title>製品の新規登録の流れ</title>
        {[
          { x: 5, n: "1", t: "基本情報", s: "コード・名称" },
          { x: 165, n: "2", t: "組成", s: "何が入っているか" },
          { x: 325, n: "3", t: "備考", s: "自由記述" },
        ].map((b) => (
          <g key={b.n}>
            <rect x={b.x} y={20} width={130} height={54} {...BOX} strokeWidth={1.5} />
            <circle cx={b.x + 20} cy={40} r={10} {...ACCENT} strokeWidth={1.5} />
            <text x={b.x + 20} y={44} textAnchor="middle" {...SMALL}>
              {b.n}
            </text>
            <text x={b.x + 38} y={44} {...LABEL}>
              {b.t}
            </text>
            <text x={b.x + 12} y={64} {...SMALL}>
              {b.s}
            </text>
          </g>
        ))}
        <Arrow x1={135} y={47} x2={165} label="次へ" />
        <Arrow x1={295} y={47} x2={325} label="次へ" />
        <text x={70} y={95} textAnchor="middle" {...SMALL} fill="var(--primary)">
          ここで登録される
        </text>
        <text x={390} y={95} textAnchor="middle" {...SMALL}>
          「保存」で仕上げ
        </text>
      </svg>
    </Figure>
  );
}

/** 一覧が上下2つに分かれる */
export function TwoTablesDiagram() {
  return (
    <Figure caption="上は誰でも見られる公開済のもの。下は自分たちがまだ手を入れている最中のものです。">
      <svg viewBox="0 0 420 190" width="100%" style={{ maxWidth: 420 }} role="img">
        <title>一覧が上下2つに分かれる</title>

        <rect x={5} y={5} width={410} height={75} {...ACCENT} strokeWidth={1.5} />
        <text x={16} y={26} {...LABEL}>
          （見出しなし）
        </text>
        <text x={16} y={46} {...SMALL}>
          公開済のものだけ／見る権限があれば誰でも
        </text>
        <text x={16} y={66} {...SMALL}>
          組成の材料に選べるのは、ここにあるものです
        </text>

        <rect x={5} y={100} width={410} height={85} {...BOX} strokeWidth={1.5} />
        <text x={16} y={121} {...LABEL}>
          作業中
        </text>
        <text x={16} y={141} {...SMALL}>
          作成中・承認待・却下／未公開のものを扱える人だけ
        </text>
        <text x={16} y={161} {...SMALL}>
          登録したのに見つからないときは、こちらを見てください
        </text>
        <text x={16} y={178} {...SMALL} fill="var(--destructive)">
          却下されたものは赤い太字で出ます
        </text>
      </svg>
    </Figure>
  );
}
