import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerMessages } from "@/lib/i18n";

/**
 * ホーム。
 * 現時点では作った機能を並べるだけ。ダッシュボードの中身は機能が揃ってから決める。
 */
export default async function HomePage() {
  const m = await getServerMessages();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.home.title}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.home.doneSoFar}</CardTitle>
          <CardDescription>{m.home.doneSoFarDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            <li>{m.home.itemAuth}</li>
            <li>{m.home.itemSidebar}</li>
            <li>{m.home.itemLanguage}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
