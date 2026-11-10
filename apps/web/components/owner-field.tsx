"use client";

import { pickName } from "@chem/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FieldError } from "@/components/field-error";
import { OwnerSelect } from "@/components/owner-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";
import { useOwnerChoices } from "@/lib/use-owner-choices";

/**
 * 製品・物質の「所属先」の欄（S31 画面設計 7・8 章）。
 * - 作るとき: 選ぶ欄（1 つしか無ければ自動で決まる。2 つ以上・システム管理グループは必ず選ぶ）
 * - 既にあるもの: 表示のみ。所属先は編集では直せず、「所属先の変更」で移す（誤って変えないため）
 */
export function OwnerField({
  target,
  entityId,
  value,
  onChange,
  current,
  canMove,
  error,
}: {
  target: "product" | "substance";
  /** 既にあるものの id。無ければ作るとき */
  entityId: string | null;
  value: string;
  onChange: (id: string) => void;
  /** 既にあるものの今の所属先の名前 */
  current?: { nameJa: string; nameEn: string | null } | null;
  /** 「所属先の変更」を出すか（そのデータを直せる人だけ） */
  canMove?: boolean;
  error?: string;
}) {
  const { m, locale } = useI18n();
  const creating = entityId === null;
  const choices = useOwnerChoices(target, creating);
  const [moving, setMoving] = useState(false);

  return (
    <div className="space-y-2">
      <Label htmlFor="owner">{m.owner.label}</Label>
      {creating ? (
        <OwnerSelect id="owner" choices={choices} value={value} onChange={onChange} />
      ) : (
        <div className="flex h-9 items-center gap-3 text-sm">
          <span>{current ? pickName(locale, current.nameJa, current.nameEn) : ""}</span>
          {canMove && (
            <Button type="button" size="sm" variant="outline" onClick={() => setMoving(true)}>
              {m.owner.move}
            </Button>
          )}
        </div>
      )}
      <FieldError message={error} />
      {moving && entityId && (
        <OwnerMoveDialog
          target={target}
          entityId={entityId}
          currentId={value}
          currentName={current ? pickName(locale, current.nameJa, current.nameEn) : ""}
          onClose={() => setMoving(false)}
        />
      )}
    </div>
  );
}

/** 所属先の変更の小窓（S31 画面設計 8 章） */
function OwnerMoveDialog({
  target,
  entityId,
  currentId,
  currentName,
  onClose,
}: {
  target: "product" | "substance";
  entityId: string;
  currentId: string;
  currentName: string;
  onClose: () => void;
}) {
  const { m, locale } = useI18n();
  const router = useRouter();
  const choices = useOwnerChoices(target);
  const [to, setTo] = useState("");
  const [usedBy, setUsedBy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const base = target === "product" ? "/api/products" : "/api/substances";

  useEffect(() => {
    void (async () => {
      const res = await fetch(`${base}/${entityId}/owner`);
      if (res.ok) setUsedBy(((await res.json()) as { usedBy: number }).usedBy);
    })();
  }, [base, entityId]);

  const toItem = choices?.items.find((c) => c.id === to);
  const toName = toItem ? pickName(locale, toItem.nameJa, toItem.nameEn) : "";

  async function move() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${base}/${entityId}/owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerGroupId: to }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as ApiError | null;
        setError(b?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const { stillVisible } = (await res.json()) as { stillVisible?: boolean };
      if (stillVisible === false) {
        // 移した先が自分には見えない。一覧へ戻す
        router.push(target === "product" ? "/products" : "/substances");
        return;
      }
      onClose();
      router.refresh();
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      role="dialog"
    >
      <div className="bg-background w-full max-w-md space-y-3 border p-4 shadow-lg">
        <h2 className="text-base font-semibold">{m.owner.moveTitle}</h2>
        <div className="space-y-2">
          <Label htmlFor="owner-to">{m.owner.moveTo}</Label>
          <OwnerSelect
            id="owner-to"
            choices={choices}
            value={to}
            onChange={setTo}
            exclude={currentId}
          />
        </div>
        {usedBy !== null && usedBy > 0 && to && (
          <Alert>
            <AlertDescription>
              {target === "product"
                ? m.owner.moveWarnMaterial(usedBy, currentName, toName)
                : m.owner.moveWarnSubstance(usedBy, currentName, toName)}
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {m.common.cancel}
          </Button>
          <Button type="button" disabled={!to || saving} onClick={() => void move()}>
            {m.owner.moveDo}
          </Button>
        </div>
      </div>
    </div>
  );
}
