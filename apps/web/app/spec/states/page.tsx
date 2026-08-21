import type { ReactNode } from "react";
import { List, Note, P, PageHead, Section, SpecTable, StateChip, Sub, T } from "../_parts";
import { SpecPager } from "../spec-pager";

/** 図の中の矢印。上に操作の名前を載せる */
function Arrow({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 flex-col items-center px-1">
      <span className="text-muted-foreground text-xs whitespace-nowrap">{label}</span>
      <span className="text-muted-foreground leading-none">→</span>
    </div>
  );
}

function DownArrow({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-1 pl-2">
      <span className="text-muted-foreground leading-none">↓</span>
      <span className="text-muted-foreground text-xs whitespace-nowrap">{label}</span>
    </div>
  );
}

function Flow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-border space-y-3 border p-4">
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

export default function SpecStatesPage() {
  return (
    <>
      <PageHead
        title="状態と承認の流れ"
        lead="登録したものが、他の人に使われるようになるまでの流れです。入力の途中のものが間違って使われないように、段階を分けています。"
      />

      <Section title="なぜ段階を分けるのか">
        <P>
          物質や製品は、一度登録すると他の人が組成の材料として選べるようになります。
          入力の途中のものがそこに並んでしまうと、まだ正しくない情報を元に組成が作られてしまいます。
        </P>
        <P>
          そこで、<T>登録しただけでは他の人に見えない</T>ようにしてあります。
          「これで完成」と決めて操作したときに、はじめて他の人が使えるようになります。
        </P>
      </Section>

      <Section title="4つの状態">
        <SpecTable
          head={["状態", "意味", "他の人から見えるか", "組成の材料に選べるか"]}
          rows={[
            [
              <StateChip key="d" tone="draft">
                作成中
              </StateChip>,
              "入力の途中。登録した直後はこれ",
              "作った本人と、権限のある人だけ",
              "選べない",
            ],
            [
              <StateChip key="p" tone="pending">
                承認待
              </StateChip>,
              "完成したので確認してほしい、と申し出た状態",
              "作った本人と、権限のある人だけ",
              "選べない",
            ],
            [
              <StateChip key="r" tone="rejected">
                却下
              </StateChip>,
              "確認した人が「まだ直すところがある」と判断した状態",
              "作った本人と、権限のある人だけ",
              "選べない",
            ],
            [
              <StateChip key="pub" tone="published">
                公開済
              </StateChip>,
              "確認が済み、みんなが使ってよい状態",
              "見る権限がある人みんな",
              "選べる",
            ],
          ]}
        />
        <Note title="「無効」とは別のものです">
          「有効 / 無効」は、いま扱っている品かどうか（廃番かどうか）を表します。
          ここでいう状態は、情報が使える状態まで仕上がっているかどうかを表すもので、別の軸です。
          廃番になった品を「無効」かつ「公開済」にしておく、といった組み合わせもあります。
        </Note>
      </Section>

      <Section title="流れの図">
        <P>
          承認を通すかどうかは、種類ごと（物質 / 製品）にシステム設定で切り替えられます。
          設定によって、流れが次の2通りに変わります。
        </P>

        <Flow title="承認が必要な設定のとき">
          <div className="flex flex-wrap items-center gap-1">
            <StateChip tone="draft">作成中</StateChip>
            <Arrow label="申請" />
            <StateChip tone="pending">承認待</StateChip>
            <Arrow label="承認" />
            <StateChip tone="published">公開済</StateChip>
          </div>
          <DownArrow label="却下されたとき" />
          <div className="flex flex-wrap items-center gap-1 pl-2">
            <StateChip tone="rejected">却下</StateChip>
            <Arrow label="直して保存" />
            <StateChip tone="draft">作成中</StateChip>
            <Arrow label="もう一度申請" />
            <StateChip tone="pending">承認待</StateChip>
          </div>
        </Flow>

        <Flow title="承認が要らない設定のとき">
          <div className="flex flex-wrap items-center gap-1">
            <StateChip tone="draft">作成中</StateChip>
            <Arrow label="発行" />
            <StateChip tone="published">公開済</StateChip>
          </div>
        </Flow>

        <Flow title="公開をやめるとき（どちらの設定でも同じ）">
          <div className="flex flex-wrap items-center gap-1">
            <StateChip tone="published">公開済</StateChip>
            <Arrow label="作成中に戻す" />
            <StateChip tone="draft">作成中</StateChip>
          </div>
        </Flow>
      </Section>

      <Section title="できる操作">
        <SpecTable
          head={["操作", "できる人", "できるとき", "そのあとの状態"]}
          rows={[
            [
              <T key="a">申請</T>,
              "そのデータを編集できる人",
              <>
                <StateChip tone="draft">作成中</StateChip> か{" "}
                <StateChip tone="rejected">却下</StateChip> のとき
              </>,
              <StateChip key="v" tone="pending">
                承認待
              </StateChip>,
            ],
            [
              <T key="b">取り下げ</T>,
              "そのデータを編集できる人",
              <>
                <StateChip tone="pending">承認待</StateChip> のとき
              </>,
              <StateChip key="v" tone="draft">
                作成中
              </StateChip>,
            ],
            [
              <T key="c">承認</T>,
              "承認の権限を持つ人",
              <>
                <StateChip tone="pending">承認待</StateChip> のとき
              </>,
              <StateChip key="v" tone="published">
                公開済
              </StateChip>,
            ],
            [
              <T key="d">却下</T>,
              "承認の権限を持つ人",
              <>
                <StateChip tone="pending">承認待</StateChip> のとき
              </>,
              <StateChip key="v" tone="rejected">
                却下
              </StateChip>,
            ],
            [
              <T key="e">発行</T>,
              "そのデータを編集できる人",
              "承認が要らない設定のとき",
              <StateChip key="v" tone="published">
                公開済
              </StateChip>,
            ],
            [
              <T key="f">作成中に戻す</T>,
              "そのデータを編集できる人",
              <>
                <StateChip tone="published">公開済</StateChip> で、他から使われていないとき
              </>,
              <StateChip key="v" tone="draft">
                作成中
              </StateChip>,
            ],
          ]}
        />
        <P>
          一覧では、行を選んでまとめて申請・発行できます。
          対象にならない行が混ざっていたときは、その理由を画面に出します。
        </P>
      </Section>

      <Section title="よくある疑問">
        <Sub title="保存したら公開されますか">
          <P>
            されません。保存は入力内容を書き留めるだけで、状態は動きません。
            公開するかどうかは「申請」「発行」といった専用の操作でだけ決まります。
            うっかり公開してしまうことを避けるためです。
          </P>
        </Sub>

        <Sub title="却下されたものを直したら、また申請し直しですか">
          <P>
            直して保存すると、自動で <StateChip tone="draft">作成中</StateChip> に戻ります。
            そのうえで、あらためて申請してください。
          </P>
          <P>
            直したのに <StateChip tone="rejected">却下</StateChip>{" "}
            のまま並んでいると、対応が済んだのか分からなくなるためです。
            新しいデータが増えるわけではなく、元のデータがそのまま作成中に戻ります。
          </P>
        </Sub>

        <Sub title="承認待のものを直したいときは">
          <P>
            <StateChip tone="pending">承認待</StateChip>{" "}
            の間は、作った本人も含めて誰も編集できません。
            確認している最中に中身が変わると、何を承認したのか分からなくなるためです。
            直したいときは、いったん「取り下げ」で作成中に戻してください。
          </P>
        </Sub>

        <Sub title="公開をやめたいのに「できません」と出ます">
          <P>
            そのデータが、公開済の製品の組成の中で使われている場合は、公開をやめられません。
            やめてしまうと、公開済の製品が「使えない材料」を含んだ状態になるためです。
          </P>
          <P>
            断るときは、どの製品から使われているかを画面に出します。
            先にその製品を作成中に戻してから、もう一度お試しください。
          </P>
        </Sub>

        <Sub title="自分で申請して、自分で承認してもよいですか">
          <P>
            できます。担当者が1人しかいない場合に手が止まってしまうためです。
            ただし、誰がいつ承認したかは記録に残ります。
          </P>
        </Sub>

        <Sub title="設定を「承認が必要」から「不要」に変えたら、承認待のものはどうなりますか">
          <P>
            承認する人がいなくなってしまうので、そのままにはできません。
            設定を保存するときに残っている件数をお知らせして、
            <T>そのまま公開する</T>か<T>作成中に戻す</T>かを選んでいただきます。
            どちらを選んでも、記録には「承認を不要に切り替えたため」として残ります。
          </P>
          <P>
            逆に「不要」から「必要」に変えたときは、すでに公開済のものはそのままです。
            あらためて承認をやり直す必要はありません。
          </P>
        </Sub>
      </Section>

      <Section title="記録">
        <P>
          申請・承認・却下・取り下げ・公開の取り消しは、すべて記録されます。
          詳細画面の下に、新しい順で並びます。
        </P>
        <List
          items={[
            "いつ、だれが、どの操作をしたか",
            "却下したときに書いた理由（任意）",
            "システムの都合で状態が変わった場合は、その理由",
          ]}
        />
        <P>この記録は、編集できる人と承認できる人にだけ見えます。</P>
      </Section>

      <SpecPager current="/spec/states" />
    </>
  );
}
