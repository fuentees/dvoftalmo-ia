import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { tmpdir } from "os";
import { DBFFile } from "dbffile";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireCevespSyncPermission } from "@/lib/admin-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((item) => item.trim().replace(/^"|"$/g, ""));
  return lines.slice(1, 101).map((line) => {
    const values = line.split(sep).map((item) => item.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scoreBank(columns: string[]) {
  const normalized = columns.map(normalize);
  const hasAny = (patterns: RegExp[]) => normalized.some((column) => patterns.some((pattern) => pattern.test(column)));
  const traconetScore = [
    hasAny([/nu_notific/, /nnotific/, /notific/]),
    hasAny([/forma.*tf/, /^tf$/, /tracoma.*folic/]),
    hasAny([/forma.*tt/, /^tt$/, /triqui/]),
    hasAny([/dt_nasc/, /nasc/, /idade/]),
    hasAny([/nm_mae/, /mae/, /paciente/, /nome/])
  ].filter(Boolean).length;
  const nottraconetScore = [
    hasAny([/casoexa/, /examin/, /avaliad/, /pesquis/]),
    hasAny([/casopos/, /positivo/, /positiv/]),
    hasAny([/tratad/, /tratam/]),
    !hasAny([/nu_notific/, /dt_nasc/, /nm_mae/])
  ].filter(Boolean).length;
  const suggestedBank = traconetScore >= nottraconetScore ? "traconet" : "nottraconet";
  return { traconetScore, nottraconetScore, suggestedBank };
}

function findYears(rows: Array<Record<string, unknown>>) {
  const years = new Set<number>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (!/(ano|dt|data|notific)/i.test(key)) continue;
      const text = String(value ?? "");
      const direct = Number(text);
      if (Number.isInteger(direct) && direct > 1900 && direct < 2100) years.add(direct);
      const match = text.match(/\b(19|20)\d{2}\b/);
      if (match) years.add(Number(match[0]));
    }
  }
  return Array.from(years).sort((a, b) => a - b).slice(0, 12);
}

function findMunicipalityFields(columns: string[]) {
  return columns.filter((column) => /munic|municip|id_munic|co_munic/i.test(column)).slice(0, 8);
}

function summarizeRows(rows: Array<Record<string, unknown>>, totalRows: number, fileName: string) {
  const columns = Object.keys(rows[0] ?? {});
  const bank = scoreBank(columns);
  return {
    fileName,
    totalRows,
    sampleRows: rows.slice(0, 5),
    columns,
    years: findYears(rows),
    municipalityFields: findMunicipalityFields(columns),
    ...bank,
    warnings: [
      ...(bank.traconetScore === bank.nottraconetScore ? ["Banco nao foi identificado com alta confianca; confira a escolha antes de importar."] : []),
      ...(columns.length === 0 ? ["Nenhuma coluna reconhecida no arquivo."] : []),
      ...(findMunicipalityFields(columns).length === 0 ? ["Nao encontrei campo obvio de municipio/codigo IBGE na amostra."] : [])
    ]
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireCevespSyncPermission(supabase, user.id);
  if (denied) return denied;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
  }

  const lower = file.name.toLowerCase();
  const tmpPath = join(tmpdir(), `sinan-preview-${randomUUID()}.dbf`);
  try {
    if (lower.endsWith(".dbf")) {
      const bytes = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(tmpPath, bytes);
      const dbf = await DBFFile.open(tmpPath, { encoding: "latin1" });
      const rows = await dbf.readRecords(Math.min(dbf.recordCount, 100));
      return NextResponse.json(summarizeRows(rows as Array<Record<string, unknown>>, dbf.recordCount, file.name));
    }

    const text = Buffer.from(await file.arrayBuffer()).toString("utf8");
    const rows = lower.endsWith(".csv")
      ? parseCsv(text)
      : (JSON.parse(text) as Array<Record<string, unknown>>).slice(0, 100);
    if (!Array.isArray(rows)) throw new Error("Arquivo JSON precisa conter uma lista de registros.");
    return NextResponse.json(summarizeRows(rows, rows.length, file.name));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao validar arquivo SINAN." },
      { status: 500 }
    );
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}
