"use client";

import { use } from "react";
import { PermissionGroupForm } from "@/components/permission-group-form";

/** 権限グループの詳細（S31 画面設計 3 章）。表示のみで開き、「編集」で書き換える */
export default function PermissionGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PermissionGroupForm id={id} />;
}
