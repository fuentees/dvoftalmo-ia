import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { decodeSinanAgeYears, tracomaAgeGroup, TRACOMA_AGE_ORDER } from "@/lib/sinan-age";
import { matchesTracomaGeography, tracomaYear, validateTracomaFilters, type TracomaFilter } from "@/lib/tracoma-data";
import { clinicalFormsFromAuditRow } from "@/services/sinan-tracoma";

type ClinicalForm = "TF" | "TI" | "TS" | "TT" | "CO";

type RawRow = {
  ano?: number | null;
  municipio?: string | null;
  gve?: string | null;
  ibge?: string | null;
  dt_notificacao?: string | null;
  classificacao?: string | null;
  raw?: Record<string, unknown> | null;
};

type Bucket = { label: string; total: number };
type CrossBucket = { label: string; TF: number; TI: number; TS: number; TT: number; CO: number; semForma: number; total: number };

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function rawValue(row: RawRow, candidates: string[]) {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  const keys = Object.keys(raw);
  for (const candidate of candidates) {
    const key = keys.find((item) => item.toLowerCase() === candidate.toLowerCase());
    if (key && raw[key] != null && String(raw[key]).trim() !== "") return raw[key];
  }
  return null;
}

function resolveSex(row: RawRow) {
  const value = normalizeText(rawValue(row, ["CS_SEXO", "SEXO", "TP_SEXO", "SEX", "GENERO", "GÊNERO"]));
  if (!value) return "Não informado";
  if (["M", "1", "MASC", "MASCULINO", "HOMEM"].includes(value)) return "Masculino";
  if (["F", "2", "FEM", "FEMININO", "MULHER"].includes(value)) return "Feminino";
  return "Ignorado/não mapeado";
}

function fullDate(value: unknown) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) ?? text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (!match) return null;
  const [year, month, day] = match[1].length === 4 ? [Number(match[1]), Number(match[2]), Number(match[3])] : [Number(match[3]), Number(match[2]), Number(match[1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function resolveAge(row: RawRow) {
  for (const field of ["NU_IDADE_N", "NU_IDADE", "IDADE", "IDADE_ANOS", "IDADEANO"]) {
    const age = decodeSinanAgeYears(rawValue(row, [field]));
    if (age != null) return age;
  }

  const birth = fullDate(rawValue(row, ["DT_NASC", "DT_NASCIMENTO", "DATA_NASC", "NASCIMENTO", "DT_NASCI"]));
  const notification = fullDate(row.dt_notificacao ?? rawValue(row, ["DT_NOTIFIC", "DT_NOTIFICACAO", "DT_NOT"]));
  if (birth && notification && notification >= birth) {
    let age = notification.getUTCFullYear() - birth.getUTCFullYear();
    if (notification.getUTCMonth() < birth.getUTCMonth() || (notification.getUTCMonth() === birth.getUTCMonth() && notification.getUTCDate() < birth.getUTCDate())) age -= 1;
    return age <= 130 ? age : null;
  }
  return null;
}

function clinicalForms(row: RawRow): ClinicalForm[] {
  return clinicalFormsFromAuditRow({ ...row, source_bank: "traconet" });
}

function add(map: Map<string, number>, label: string, amount = 1) {
  map.set(label, (map.get(label) ?? 0) + amount);
}

function toBuckets(map: Map<string, number>, order?: string[]) {
  const rows = Array.from(map.entries()).map(([label, total]) => ({ label, total }));
  if (order) {
    return rows.sort((a, b) => (order.indexOf(a.label) === -1 ? 999 : order.indexOf(a.label)) - (order.indexOf(b.label) === -1 ? 999 : order.indexOf(b.label)));
  }
  return rows.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "pt-BR"));
}

function emptyCross(label: string): CrossBucket {
  return { label, TF: 0, TI: 0, TS: 0, TT: 0, CO: 0, semForma: 0, total: 0 };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const gve = searchParams.get("gve") ?? "";
  const municipio = searchParams.get("municipio") ?? "";
  let filters: TracomaFilter;
  try {
    filters = validateTracomaFilters({ gve, municipio, yearStart: searchParams.get("yearStart"), yearEnd: searchParams.get("yearEnd") });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  const { yearStart, yearEnd } = filters;

  try {
    const admin = createAdminClient();
    const rows: RawRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let query = admin
        .from("sinan_tracoma_rows")
        .select("ano, municipio, ibge, gve, dt_notificacao, classificacao, raw")
        .eq("source_bank", "traconet")
        .order("id")
        .range(from, from + pageSize - 1);
      if (yearStart) query = query.gte("ano", yearStart);
      if (yearEnd) query = query.lte("ano", yearEnd);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as RawRow[]));
      if (!data || data.length < pageSize) break;
    }

    const filtered = rows.filter((row) => matchesTracomaGeography(row, filters) && tracomaYear(row.ano) != null);

    const sexMap = new Map<string, number>();
    const ageMap = new Map<string, number>();
    const formMap = new Map<string, number>();
    const sexByForm = new Map<string, CrossBucket>();
    const ageByForm = new Map<string, CrossBucket>();
    let withSex = 0;
    let withAge = 0;
    let withClinicalForm = 0;

    for (const row of filtered) {
      const sex = resolveSex(row);
      const age = resolveAge(row);
      const ageLabel = tracomaAgeGroup(age);
      const forms = clinicalForms(row);
      if (["Masculino", "Feminino"].includes(sex)) withSex += 1;
      if (age != null) withAge += 1;
      if (forms.length > 0) withClinicalForm += 1;

      add(sexMap, sex);
      add(ageMap, ageLabel);
      for (const form of forms) add(formMap, form);
      if (forms.length === 0) add(formMap, "Sem forma");

      const sexCross = sexByForm.get(sex) ?? emptyCross(sex);
      const ageCross = ageByForm.get(ageLabel) ?? emptyCross(ageLabel);
      sexCross.total += 1;
      ageCross.total += 1;
      if (forms.length === 0) {
        sexCross.semForma += 1;
        ageCross.semForma += 1;
      } else {
        for (const form of forms) {
          sexCross[form] += 1;
          ageCross[form] += 1;
        }
      }
      sexByForm.set(sex, sexCross);
      ageByForm.set(ageLabel, ageCross);
    }

    return NextResponse.json({
      totalRows: filtered.length,
      withSex,
      withAge,
      withClinicalForm,
      sexDistribution: toBuckets(sexMap),
      ageDistribution: toBuckets(ageMap, TRACOMA_AGE_ORDER),
      clinicalForms: toBuckets(formMap, ["TF", "TI", "TS", "TT", "CO", "Sem forma"]),
      sexByForm: Array.from(sexByForm.values()).sort((a, b) => b.total - a.total),
      ageByForm: Array.from(ageByForm.values()).sort((a, b) => (TRACOMA_AGE_ORDER.indexOf(a.label) === -1 ? 999 : TRACOMA_AGE_ORDER.indexOf(a.label)) - (TRACOMA_AGE_ORDER.indexOf(b.label) === -1 ? 999 : TRACOMA_AGE_ORDER.indexOf(b.label))),
      warnings: ["Um registro pode ter várias formas clínicas. Os percentuais de formas usam o total de registros e podem somar mais de 100%.", ...(rows.length > filtered.length ? [`${rows.length - filtered.length} linha(s) fora do recorte geográfico ou sem ano válido não entraram no perfil.`] : [])],
      filters: { gve: gve || null, municipio: municipio || null, yearStart: yearStart ?? null, yearEnd: yearEnd ?? null }
    });
  } catch (error) {
    console.error("Falha na demografia SINAN Tracoma", error);
    const message = "Não foi possível carregar o perfil demográfico. Tente novamente ou verifique a sincronização.";
    return NextResponse.json({
      missingData: true,
      error: message,
      message,
      totalRows: 0,
      withSex: 0,
      withAge: 0,
      withClinicalForm: 0,
      sexDistribution: [] as Bucket[],
      ageDistribution: [] as Bucket[],
      clinicalForms: [] as Bucket[],
      sexByForm: [] as CrossBucket[],
      ageByForm: [] as CrossBucket[]
    }, { status: 503 });
  }
}
