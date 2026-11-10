"use client";

import { pickName, type Locale } from "@chem/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StaleEditNotice } from "@/components/stale-edit-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EditingBadge } from "@/components/editing-badge";
import { EditButton } from "@/components/edit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import { readStaleEdit, type StaleEditInfo } from "@/lib/stale-edit";
import type { ApiError, NewsDto, NewsOrganisationChoicesDto } from "@/lib/types";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

interface Props {
  /** 既存の内容。未指定なら新規作成 */
  initial?: NewsDto;
  /**
   * 編集できるか。既存のお知らせは、まず読み取り専用で見せて
   * 「編集」ボタンを押してから書き換えられるようにする（物質マスタと同じ形）。
   */
  canEdit: boolean;
}

/** 宛先の「全員」を選択肢の値で表す印（API には null で送る） */
const TO_ALL = "__all__";

/**
 * 差出元・宛先の選択肢。選べる組織（自分の組織とその上）に、いま付いている値を足す。
 * 異動したあとや、管理する人が他人の分を直すときに、今の値が選択肢から消えないように
 */
function orgOptions(
  choices: NewsOrganisationChoicesDto | null,
  locale: Locale,
  current: { id: string | null; ja: string | null; en: string | null } | null,
): { id: string; label: string }[] {
  const list = (choices?.choices ?? []).map((o) => ({
    id: o.id,
    label: pickName(locale, o.nameJa, o.nameEn),
  }));
  if (current?.id && !list.some((o) => o.id === current.id)) {
    list.push({ id: current.id, label: pickName(locale, current.ja ?? "", current.en) });
  }
  return list;
}

/** お知らせの詳細・作成・編集フォーム */
export function NewsForm({ initial, canEdit }: Props) {
  const router = useRouter();
  const { m, locale } = useI18n();
  const [editing, setEditing] = useState(!initial);
  const readOnly = !canEdit || !editing;
  const [titleJa, setTitleJa] = useState(initial?.titleJa ?? "");
  const [bodyJa, setBodyJa] = useState(initial?.bodyJa ?? "");
  const [titleEn, setTitleEn] = useState(initial?.titleEn ?? "");
  const [bodyEn, setBodyEn] = useState(initial?.bodyEn ?? "");
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">(initial?.status ?? "DRAFT");
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [publishFrom, setPublishFrom] = useState(initial?.publishFrom ?? "");
  const [publishUntil, setPublishUntil] = useState(initial?.publishUntil ?? "");
  /** 差出元・宛先（2026-11-11）。新規は、自分の組織が最初から選ばれる */
  const [fromId, setFromId] = useState(initial?.fromOrganisationId ?? "");
  const [toId, setToId] = useState(initial ? (initial.toOrganisationId ?? TO_ALL) : "");
  const [choices, setChoices] = useState<NewsOrganisationChoicesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** ほかの人が先に保存していた知らせ（楽観的ロック） */
  const [stale, setStale] = useState<StaleEditInfo | null>(null);
  const [saving, setSaving] = useState(false);

  // 選べる組織は、書き換えられる人のときだけ読む
  useEffect(() => {
    if (!canEdit) return;
    void (async () => {
      const res = await fetch("/api/news/organisations");
      if (!res.ok) return;
      const body = (await res.json()) as NewsOrganisationChoicesDto;
      setChoices(body);
      const own = body.ownId;
      if (!initial && own) {
        setFromId((v) => v || own);
        setToId((v) => v || own);
      }
    })();
  }, [canEdit, initial]);

  const fromOptions = orgOptions(
    choices,
    locale,
    initial
      ? { id: initial.fromOrganisationId, ja: initial.fromNameJa, en: initial.fromNameEn }
      : null,
  );
  const toOptions = orgOptions(
    choices,
    locale,
    initial ? { id: initial.toOrganisationId, ja: initial.toNameJa, en: initial.toNameEn } : null,
  );
  // 「全員」は、選べる人か、いま全員宛てのものを開いたときだけ出す
  const showToAll =
    Boolean(choices?.canAll) || (initial !== undefined && !initial.toOrganisationId);
  // 組織の無い人は新しく投稿できない
  const noOrganisation = !initial && choices !== null && choices.ownId === null;

  async function save(force = false) {
    setError(null);
    if (!force) setStale(null);
    setSaving(true);
    try {
      const res = await fetch(initial ? `/api/news/${initial.id}` : "/api/news", {
        method: initial ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 既存のものなら読み込んだときの印を添える（楽観的ロック）。force は「このまま保存する」
          ...(initial ? { stamp: initial.stamp, force: force || undefined } : {}),
          titleJa,
          bodyJa,
          titleEn: titleEn || null,
          bodyEn: bodyEn || null,
          status,
          pinned,
          publishFrom: publishFrom || null,
          publishUntil: publishUntil || null,
          fromOrganisationId: fromId,
          // 空のまま送ると「全員」にならないよう、全員は印のときだけ null にする
          toOrganisationId: toId === TO_ALL ? null : toId,
        }),
      });
      // ほかの人が先に保存していた。入力はそのまま残し、見てから決めてもらう
      const staleInfo = await readStaleEdit(res);
      if (staleInfo) {
        setStale(staleInfo);
        return;
      }
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      router.push("/news");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 状態と編集ボタンは form の外に置く（送信と受け取られないように） */}
      {initial && (readOnly ? canEdit : true) && (
        <div className="flex items-center gap-3">
          {readOnly ? <EditButton onClick={() => setEditing(true)} /> : <EditingBadge />}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-4"
      >
        {noOrganisation && (
          <Alert variant="destructive">
            <AlertDescription>{m.news.noOrganisation}</AlertDescription>
          </Alert>
        )}
        <fieldset disabled={readOnly} className="space-y-4">
          {/* どこから・だれ宛て（2026-11-11）。自分の組織とその上から選ぶ */}
          <Card>
            <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="newsFrom">{m.news.from}</Label>
                <select
                  id="newsFrom"
                  required
                  value={fromId}
                  onChange={(e) => setFromId(e.target.value)}
                  className="border-input bg-background h-9 w-full rounded-none border px-2 text-sm"
                >
                  {fromId === "" && <option value="" />}
                  {fromOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground text-xs">{m.news.fromHint}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="newsTo">{m.news.to}</Label>
                <select
                  id="newsTo"
                  required
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                  className="border-input bg-background h-9 w-full rounded-none border px-2 text-sm"
                >
                  {toId === "" && <option value="" />}
                  {showToAll && <option value={TO_ALL}>{m.news.toAll}</option>}
                  {toOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground text-xs">
                  {m.news.toHint}
                  {showToAll && <>{` ${m.news.toAllHint}`}</>}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <Label htmlFor="titleJa">{m.news.titleJa}</Label>
                <Input
                  id="titleJa"
                  required
                  value={titleJa}
                  onChange={(e) => setTitleJa(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bodyJa">{m.news.bodyJa}</Label>
                <textarea
                  id="bodyJa"
                  required
                  rows={6}
                  value={bodyJa}
                  onChange={(e) => setBodyJa(e.target.value)}
                  className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="titleEn">
                  {m.news.titleEn}
                  {m.common.optional}
                </Label>
                <Input id="titleEn" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bodyEn">
                  {m.news.bodyEn}
                  {m.common.optional}
                </Label>
                <textarea
                  id="bodyEn"
                  rows={6}
                  value={bodyEn}
                  onChange={(e) => setBodyEn(e.target.value)}
                  className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
                />
                <p className="text-muted-foreground text-xs">{m.news.englishHint}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <Label htmlFor="status">{m.news.status}</Label>
                <select
                  id="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "DRAFT" | "PUBLISHED")}
                  className="border-input bg-background h-9 rounded-none border px-2 text-sm"
                >
                  <option value="DRAFT">{m.news.draft}</option>
                  <option value="PUBLISHED">{m.news.published}</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                />
                {m.news.pinned}
              </label>
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2">
                  <Label htmlFor="from">{m.news.publishFrom}</Label>
                  <Input
                    id="from"
                    type="date"
                    value={publishFrom}
                    onChange={(e) => setPublishFrom(e.target.value)}
                    className="w-44"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="until">{m.news.publishUntil}</Label>
                  <Input
                    id="until"
                    type="date"
                    value={publishUntil}
                    onChange={(e) => setPublishUntil(e.target.value)}
                    className="w-44"
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-xs">{m.news.periodHint}</p>
            </CardContent>
          </Card>
        </fieldset>

        <StaleEditNotice
          stale={stale}
          saving={saving}
          onForce={() => void save(true)}
          onDismiss={() => setStale(null)}
        />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 保存ボタンは編集中だけ。表示のみのときは form の中に送信ボタンを置かない */}
        {!readOnly && (
          <div className="flex gap-2">
            <Button type="submit" disabled={saving || noOrganisation}>
              {saving ? m.common.saving : m.common.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // 既存の編集をやめるときは書きかけを捨てて表示に戻す
                setStale(null);
                if (initial) router.refresh();
                else router.push("/news");
                setEditing(!initial);
              }}
            >
              {initial ? m.common.discard : m.common.cancel}
            </Button>
          </div>
        )}
      </form>

      {readOnly && (
        <div className="flex gap-2">
          {canEdit && <EditButton onClick={() => setEditing(true)} />}
          <Button type="button" variant="outline" onClick={() => router.push("/news")}>
            {m.common.back}
          </Button>
        </div>
      )}
    </div>
  );
}
