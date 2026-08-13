"use client";

import { pickName, type PropertyDataType } from "@chem/shared";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, PropertyDefDto } from "@/lib/types";

const selectClass = "border-input bg-background h-9 rounded-md border px-2 text-sm";

/** 空のフォーム。新規追加と編集で同じ形を使う */
const EMPTY = {
  id: "",
  key: "",
  labelJa: "",
  labelEn: "",
  dataType: "TEXT" as PropertyDataType,
  defaultUnit: "",
  displayOrder: 0,
  activeFlag: true,
};

export default function PropertyDefsPage() {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<PropertyDefDto[] | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/substance-property-defs");
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setItems([]);
      return;
    }
    setItems(((await res.json()) as { items: PropertyDefDto[] }).items);
  }, [m]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const editing = form.id !== "";
      const res = await fetch(
        editing
          ? `/api/admin/substance-property-defs/${form.id}`
          : "/api/admin/substance-property-defs",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: form.key,
            labelJa: form.labelJa,
            labelEn: form.labelEn || null,
            dataType: form.dataType,
            defaultUnit: form.defaultUnit || null,
            displayOrder: Number(form.displayOrder) || 0,
            activeFlag: form.activeFlag,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setForm({ ...EMPTY });
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(d: PropertyDefDto) {
    if (!confirm(m.propertyDefs.deleteConfirm(pickName(locale, d.labelJa, d.labelEn)))) return;
    const res = await fetch(`/api/admin/substance-property-defs/${d.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    if (form.id === d.id) setForm({ ...EMPTY });
    void load();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.propertyDefs.title}</h1>
      <p className="text-muted-foreground text-sm">{m.propertyDefs.description}</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {form.id ? m.propertyDefs.editTitle : m.propertyDefs.newTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label htmlFor="key">{m.propertyDefs.key}</Label>
                <Input
                  id="key"
                  required
                  maxLength={50}
                  disabled={form.id !== ""}
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  className="w-48 font-mono"
                  placeholder="melting_point"
                />
                <p className="text-muted-foreground text-xs">{m.propertyDefs.keyHint}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="labelJa">{m.propertyDefs.labelJa}</Label>
                <Input
                  id="labelJa"
                  required
                  maxLength={100}
                  value={form.labelJa}
                  onChange={(e) => setForm({ ...form, labelJa: e.target.value })}
                  className="w-56"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="labelEn">
                  {m.propertyDefs.labelEn}
                  {m.common.optional}
                </Label>
                <Input
                  id="labelEn"
                  maxLength={100}
                  value={form.labelEn}
                  onChange={(e) => setForm({ ...form, labelEn: e.target.value })}
                  className="w-56"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="dataType">{m.propertyDefs.dataType}</Label>
                <select
                  id="dataType"
                  value={form.dataType}
                  onChange={(e) =>
                    setForm({ ...form, dataType: e.target.value as PropertyDataType })
                  }
                  className={selectClass}
                >
                  <option value="TEXT">{m.propertyDefs.typeText}</option>
                  <option value="NUMBER">{m.propertyDefs.typeNumber}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">
                  {m.propertyDefs.defaultUnit}
                  {m.common.optional}
                </Label>
                <Input
                  id="unit"
                  maxLength={50}
                  value={form.defaultUnit}
                  onChange={(e) => setForm({ ...form, defaultUnit: e.target.value })}
                  className="w-28"
                  placeholder="℃"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="order">{m.propertyDefs.displayOrder}</Label>
                <Input
                  id="order"
                  type="number"
                  min={0}
                  max={9999}
                  value={form.displayOrder}
                  onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })}
                  className="w-24"
                />
              </div>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.activeFlag}
                  onChange={(e) => setForm({ ...form, activeFlag: e.target.checked })}
                />
                {m.propertyDefs.activeFlag}
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? m.common.saving : m.common.save}
              </Button>
              {form.id !== "" && (
                <Button type="button" variant="outline" onClick={() => setForm({ ...EMPTY })}>
                  {m.common.cancel}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="bg-background overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{m.propertyDefs.displayOrder}</TableHead>
              <TableHead>{m.propertyDefs.key}</TableHead>
              <TableHead>{m.propertyDefs.labelJa}</TableHead>
              <TableHead className="w-24">{m.propertyDefs.dataType}</TableHead>
              <TableHead className="w-24">{m.propertyDefs.defaultUnit}</TableHead>
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items === null && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  {m.common.loading}
                </TableCell>
              </TableRow>
            )}
            {items?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  {m.propertyDefs.empty}
                </TableCell>
              </TableRow>
            )}
            {items?.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="text-muted-foreground">{d.displayOrder}</TableCell>
                <TableCell className="font-mono">{d.key}</TableCell>
                <TableCell>
                  {pickName(locale, d.labelJa, d.labelEn)}
                  {!d.activeFlag && (
                    <Badge variant="outline" className="ml-2">
                      {m.substances.statusDiscontinued}
                    </Badge>
                  )}
                  {d.valueCount > 0 && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {m.propertyDefs.valueCount(d.valueCount)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {d.dataType === "NUMBER" ? m.propertyDefs.typeNumber : m.propertyDefs.typeText}
                </TableCell>
                <TableCell>{d.defaultUnit ?? ""}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setForm({
                          id: d.id,
                          key: d.key,
                          labelJa: d.labelJa,
                          labelEn: d.labelEn ?? "",
                          dataType: d.dataType,
                          defaultUnit: d.defaultUnit ?? "",
                          displayOrder: d.displayOrder,
                          activeFlag: d.activeFlag,
                        })
                      }
                    >
                      {m.common.edit}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={() => void onDelete(d)}
                    >
                      {m.common.delete}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
