import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * ホーム。
 * 現時点では作った機能の入口を並べるだけ。ダッシュボードの中身は機能が揃ってから決める。
 */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">ホーム</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ここまでできていること</CardTitle>
          <CardDescription>機能を1つずつ確認しながら追加していきます。</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            <li>ログイン・ログアウト・パスワード変更</li>
            <li>サイドバーの開閉（左上のボタン）</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
