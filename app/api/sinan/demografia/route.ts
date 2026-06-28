import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { gvePorCodigo, listarMunicipiosSp } from "@/lib/municipios-sp";

const CLINICAL_FORMS = ["TF", "TI", "TS", "TT", "CO"] as const;
const GVE_BY_MUNICIPIO = new Map(listarMunicipiosSp().map((municipio) => [normalizeKey(municipio.nome), municipio.gve]));

type ClinicalForm = typeof CLINICAL_FORMS[number];

type RawRow = {
  ano?: number | null;
  municipio?: string | null;
  gve?: string | null;
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

function normalizeKey(value: unknown) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, "");
}

function resolveGve(row: RawRow) {
  return row.gve || gvePorCodigo(row.municipio) || GVE_BY_MUNICIPIO.get(normalizeKey(row.municipio)) || null;
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

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function yes(value: unknown) {
  return ["1", "s", "sim", "true", "x", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function resolveSex(row: RawRow) {
  const value = normalizeText(rawValue(row, ["CS_SEXO", "SEXO", "TP_SEXO", "SEX", "GENERO", "GÊNERO"]));
  if (!value) return "Não informado";
  if (["M", "1", "MASC", "MASCULINO", "HOMEM"].includes(value)) return "Masculino";
  if (["F", "2", "FEM", "FEMININO", "MULHER"].includes(value)) return "Feminino";
  return value.length > 24 ? "Outro/ignorado" : value;
}

function dateYear(value: unknown) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) ?? text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (!match) return null;
  const year = Number(match[1].length === 4 ? match[1] : match[3]);
  return Number.isFinite(year) ? year : null;
}

function resolveAge(row: RawRow) {
  const direct = toNumber(rawValue(row, ["NU_IDADE_N", "NU_IDADE", "IDADE", "IDADE_ANOS", "IDADEANO"]));
  if (direct != null && direct >= 0 && direct <= 130) return Math.trunc(direct);

  const birthYear = dateYear(rawValue(row, ["DT_NASC", "DT_NASCIMENTO", "DATA_NASC", "NASCIMENTO", "DT_NASCI"]));
  const caseYear = Number(row.ano);
  if (birthYear && Number.isFinite(caseYear) && caseYear >= birthYear) return caseYear - birthYear;
  return null;
}

function ageGroup(age: number | null) {
  if (age == null) return "Não informado";
  if (age < 1) return "Menor de 1 ano";
  if (age <= 4) return "1 a 4 anos";
  if (age <= 9) return "5 a 9 anos";
  if (age <= 14) return "10 a 14 anos";
  if (age <= 19) return "15 a 19 anos";
  if (age <= 39) return "20 a 39 anos";
  if (age <= 59) return "40 a 59 anos";
  return "60 anos ou mais";
}

function clinicalForms(row: RawRow): ClinicalForm[] {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  const found = new Set<ClinicalForm>();
  for (const form of CLINICAL_FORMS) {
    if (yes(raw[`FORMA_${form}`]) || yes(raw[`TP_FORMA_CLINICA_${form}`]) || yes(raw[form])) found.add(form);
  }
  const text = normalizeText(rawValue(row, ["CLASSI_FIN", "CLASSIFICACAO", "CLASSIFIN", "FORMA_CLINICA", "CRITERIO_CONF"]));
  for (const form of CLINICAL_FORMS) {
    if (new RegExp(`(^|[^A-Z])${form}([^A-Z]|$)`).test(text)) found.add(form);
  }
  if (text.includes("FOLICULAR")) found.add("TF");
  if (text.includes("INFLAMATOR")) found.add("TI");
  if (text.includes("CICATRIC")) found.add("TS");
  if (text.includes("TRIQUI")) found.add("TT");
  if (text.includes("CORNE") || text.includes("OPAC")) found.add("CO");
  return CLINICAL_FORMS.filter((form) => found.has(form));
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
  const yearStart = searchParams.get("yearStart") ? Number(searchParams.get("yearStart")) : undefined;
  const yearEnd = searchParams.get("yearEnd") ? Number(searchParams.get("yearEnd")) : undefined;

  try {
    const admin = createAdminClient();
    const rows: RawRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let query = admin
        .from("sinan_tracoma_rows")
        .select("ano, municipio, gve, raw")
        .eq("source_bank", "traconet")
        .range(from, from + pageSize - 1);
      if (municipio) query = query.ilike("municipio", `%${municipio}%`);
      if (yearStart) query = query.gte("ano", yearStart);
      if (yearEnd) query = query.lte("ano", yearEnd);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      rows.push(...((data ?? []) as RawRow[]));
      if (!data || data.length < pageSize) break;
    }

    const selectedGve = normalizeText(gve);
    const filtered = selectedGve
      ? rows.filter((row) => normalizeText(resolveGve(row)).includes(selectedGve))
      : rows;

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
      const ageLabel = ageGroup(age);
      const forms = clinicalForms(row);
      if (sex !== "Não informado") withSex += 1;
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

    const ageOrder = ["Menor de 1 ano", "1 a 4 anos", "5 a 9 anos", "10 a 14 anos", "15 a 19 anos", "20 a 39 anos", "40 a 59 anos", "60 anos ou mais", "Não informado"];
    return NextResponse.json({
      totalRows: filtered.length,
      withSex,
      withAge,
      withClinicalForm,
      sexDistribution: toBuckets(sexMap),
      ageDistribution: toBuckets(ageMap, ageOrder),
      clinicalForms: toBuckets(formMap, ["TF", "TI", "TS", "TT", "CO", "Sem forma"]),
      sexByForm: Array.from(sexByForm.values()).sort((a, b) => b.total - a.total),
      ageByForm: Array.from(ageByForm.values()).sort((a, b) => (ageOrder.indexOf(a.label) === -1 ? 999 : ageOrder.indexOf(a.label)) - (ageOrder.indexOf(b.label) === -1 ? 999 : ageOrder.indexOf(b.label))),
      filters: { gve: gve || null, municipio: municipio || null, yearStart: yearStart ?? null, yearEnd: yearEnd ?? null }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      missingData: true,
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
    });
  }
}
