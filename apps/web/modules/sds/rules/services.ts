// GHS 判定のルール言語（S27）の解析の入口。Node でもブラウザでも動く（ファイルは読まず、文字列を渡す）
import {
  createDefaultCoreModule,
  createDefaultSharedCoreModule,
  EmptyFileSystem,
  inject,
  URI,
  type LangiumCoreServices,
  type LangiumSharedCoreServices,
} from "langium";
import { GhsRulesGeneratedModule, GhsRulesGeneratedSharedModule } from "./generated/module";
import type { Ruleset } from "./generated/ast";

export type GhsRulesServices = LangiumCoreServices;

let cached: { shared: LangiumSharedCoreServices; ghs: GhsRulesServices } | null = null;

/** 解析の部品を 1 回だけ組み立てる */
export function getServices() {
  if (cached) return cached;
  const shared = inject(
    createDefaultSharedCoreModule(EmptyFileSystem),
    GhsRulesGeneratedSharedModule,
  );
  const ghs = inject(createDefaultCoreModule({ shared }), GhsRulesGeneratedModule);
  shared.ServiceRegistry.register(ghs);
  cached = { shared, ghs };
  return cached;
}

export interface ParseResult {
  ruleset: Ruleset | null;
  /** 文法の誤り（行・列つき）。空なら読めた */
  errors: { line: number; column: number; message: string }[];
}

let seq = 0;

/** ルールセットの文字列を読む。文法の誤りは errors に返す（例外にしない） */
export async function parseRuleset(text: string, name = `ruleset-${++seq}`): Promise<ParseResult> {
  const { shared } = getServices();
  const uri = URI.parse(`memory:///${name}.ghsrule`);
  const doc = shared.workspace.LangiumDocumentFactory.fromString<Ruleset>(text, uri);
  shared.workspace.LangiumDocuments.addDocument(doc);
  try {
    await shared.workspace.DocumentBuilder.build([doc], { validation: true });
    const errors = [
      ...doc.parseResult.lexerErrors.map((e) => ({
        line: e.line ?? 0,
        column: e.column ?? 0,
        message: e.message,
      })),
      ...doc.parseResult.parserErrors.map((e) => ({
        line: e.token.startLine ?? 0,
        column: e.token.startColumn ?? 0,
        message: e.message,
      })),
      ...(doc.diagnostics ?? [])
        .filter((d) => d.severity === 1)
        .map((d) => ({
          line: d.range.start.line + 1,
          column: d.range.start.character + 1,
          message: typeof d.message === "string" ? d.message : d.message.value,
        })),
    ];
    return {
      ruleset: errors.length === 0 ? doc.parseResult.value : (doc.parseResult.value ?? null),
      errors,
    };
  } finally {
    shared.workspace.LangiumDocuments.deleteDocument(uri);
  }
}
