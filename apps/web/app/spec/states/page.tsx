import { StateFlowDiagram, TwoTablesDiagram } from "../_diagrams";
import { List, Note, P, PageHead, Section, SpecTable, StateChip, Sub, T } from "../_parts";
import { SpecPager } from "../spec-pager";

export default function ManualStatesPage() {
  return (
    <>
      <PageHead
        title="公開までの流れ"
        lead="登録したものは、そのままでは他の人に見えません。使ってもらえるようになるまでの道のりを説明します。"
      />

      <Section title="なぜ一手間かかるのか">
        <P>
          途中まで入れただけのものが、そのまま他の人の組成に取り込まれてしまうと困るためです。
          <T>「書いている最中」と「使ってよい」を分けて</T>
          います。分ける手間はかかりますが、間違ったまま出回るより安全です。
        </P>
      </Section>

      <Section title="4つの状態">
        <SpecTable
          head={["状態", "意味", "他の人から"]}
          rows={[
            [
              <StateChip key="d" tone="draft">
                作成中
              </StateChip>,
              "書いている最中",
              "見えない",
            ],
            [
              <StateChip key="p" tone="pending">
                承認待
              </StateChip>,
              "確認をお願いしている",
              "見えない",
            ],
            [
              <StateChip key="r" tone="rejected">
                却下
              </StateChip>,
              "直してほしいと言われた",
              "見えない",
            ],
            [
              <StateChip key="b" tone="published">
                公開済
              </StateChip>,
              "使ってよい",
              "見える・組成に入れられる",
            ],
          ]}
        />
        <P>
          この4つは「有効 / 無効」とは別のものです。有効・無効は<T>廃番かどうか</T>
          、状態は<T>書き終わったかどうか</T>を表します。
        </P>
      </Section>

      <Section title="承認が要る場合と、要らない場合">
        <P>
          どちらで運用するかは、物質と製品それぞれについてシステム管理者が決めます。自分の会社が
          どちらなのかは、詳細画面に出るボタンで分かります。
        </P>

        <StateFlowDiagram />

        <Sub title="承認が要るとき">
          <P>
            <StateChip tone="draft">作成中</StateChip> →「承認を申請」→{" "}
            <StateChip tone="pending">承認待</StateChip> → 承認する人が「承認する」→{" "}
            <StateChip tone="published">公開済</StateChip>
          </P>
          <List
            items={[
              <>
                <T>承認待の間は、書いた本人も含めて誰も直せません。</T>
                直したくなったら「申請を取り下げ」で作成中に戻します
              </>,
              <>
                内容に問題があると <StateChip tone="rejected">却下</StateChip>{" "}
                になります。理由が添えられることがあります
              </>,
              <>却下されたものを直して保存すると、自動で作成中に戻ります。もう一度申請できます</>,
            ]}
          />
        </Sub>

        <Sub title="承認が要らないとき">
          <P>
            <StateChip tone="draft">作成中</StateChip> →「公開する」→{" "}
            <StateChip tone="published">公開済</StateChip>
          </P>
          <P>確認の手順が無いぶん早く済みますが、間違いもそのまま出ます。</P>
        </Sub>
      </Section>

      <Section title="一覧が上下に分かれている理由">
        <P>一覧は2つの表に分かれています。</P>
        <SpecTable
          head={["位置", "中身", "だれに見えるか"]}
          rows={[
            ["上", "公開済のものだけ", "見る権限があれば誰でも"],
            ["下（作業中）", "作成中・承認待・却下", "未公開のものを扱える人だけ"],
          ]}
        />
        <TwoTablesDiagram />
        <Note title="登録したのに一覧に出てこないとき">
          たいていは下の「作業中」の表にあります。下の表そのものが出ていない場合は、
          未公開のものを見る権限がありません。管理者に相談してください。
        </Note>
        <P>
          「作業中」の表では、行を選んでまとめて申請（または発行）できます。
          却下されたものは赤い太字で出るので、対応が必要なものがすぐ分かります。
        </P>
      </Section>

      <Section title="公開したものを取り下げる">
        <P>
          詳細画面の「作成中に戻す」で、公開をやめられます。ただし
          <T>公開済の製品から材料として使われている間は戻せません</T>。
          戻すと、その製品が使えない材料を含むことになるためです。断られたときは、どの製品から
          使われているかを画面に出します。
        </P>
      </Section>

      <Section title="よくあるつまずき">
        <SpecTable
          head={["こうなった", "たぶんこれ"]}
          rows={[
            ["登録したのに組成の候補に出てこない", "まだ公開していない（候補は公開済のものだけ）"],
            [
              "「承認待のものは、この操作の対象になりません」と出た",
              "すでに申請済み。取り下げてから直します",
            ],
            ["編集ボタンが押せない", "承認待の間は誰も直せません"],
            [
              "「この操作を行う権限がありません」と出た",
              "その操作をする権限が無い。管理者に相談してください",
            ],
          ]}
        />
      </Section>

      <SpecPager current="/spec/states" />
    </>
  );
}
