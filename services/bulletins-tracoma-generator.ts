import { createAdminClient } from "@/lib/supabase/admin";
import { generateCompletion } from "@/services/ai/provider";

export interface TracomaBulletinOptions {
  ano?: number;
  force?: boolean;
}

export interface TracomaBulletinResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  se: 0;
  ano: number;
  agravo: "tracoma";
  title?: string;
  error?: string;
}

// Fuzzy field lookup in raw SINAN JSON
function getValue(raw: Record<string, unknown>, candidates: string[]): unknown {
  const keys = Object.keys(raw);
  for (const c of candidates) {
    const key = keys.find(k => k.toLowerCase() === c.toLowerCase());
    if (key !== undefined && raw[key] != null && String(raw[key]).trim() !== "") return raw[key];
  }
  return null;
}

function toNum(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pct(num: number, den: number) {
  if (!den) return "0,0%";
  return `${((num / den) * 100).toFixed(1).replace(".", ",")}%`;
}

// NOTTRACONET consolidated field candidates
const FIELD = {
  examinados: ["NU_CASOEXA", "CASOEXA", "CASOS_EXAM", "NU_EXAM", "EXAMINADOS", "EXAMINA", "QT_EXAM", "TOT_EXAM", "NU_ALUNOS", "ALUNOS"],
  positivos:  ["NU_CASOPOS", "CASOPOS", "CASOS_POS", "NU_POSITIV", "POSITIVOS", "QT_POS", "TOT_POS"],
  tratados:   ["NU_TRATAD", "TRATADOS", "QT_TRAT", "TOTAL_TRAT"],
  tf: ["NU_TF", "TF", "CASOS_TF", "QT_TF"],
  ti: ["NU_TI", "TI", "CASOS_TI", "QT_TI"],
  ts: ["NU_TS", "TS", "CASOS_TS", "QT_TS"],
  tt: ["NU_TT", "TT", "CASOS_TT", "QT_TT"],
  co: ["NU_CO", "CO", "CASOS_CO", "QT_CO"],
};

type NottraconetRow = { municipio: string | null; gve: string | null; raw: Record<string, unknown> };
type TraconetRow   = { municipio: string | null; gve: string | null; classificacao: string | null; tratamento: string | null };

function processNottraconet(rows: NottraconetRow[]) {
  let totalExam = 0, totalPos = 0, totalTrat = 0;
  const muniMap: Record<string, { exam: number; pos: number; trat: number }> = {};
  const gveMap:  Record<string, { exam: number; pos: number }> = {};

  for (const row of rows) {
    const raw  = row.raw ?? {};
    const exam = toNum(getValue(raw, FIELD.examinados));
    const pos  = toNum(getValue(raw, FIELD.positivos));
    const trat = toNum(getValue(raw, FIELD.tratados));
    totalExam += exam;
    totalPos  += pos;
    totalTrat += trat;

    const muni = row.municipio ?? "Não informado";
    if (!muniMap[muni]) muniMap[muni] = { exam: 0, pos: 0, trat: 0 };
    muniMap[muni].exam += exam;
    muniMap[muni].pos  += pos;
    muniMap[muni].trat += trat;

    const gve = row.gve ?? "Não informado";
    if (!gveMap[gve]) gveMap[gve] = { exam: 0, pos: 0 };
    gveMap[gve].exam += exam;
    gveMap[gve].pos  += pos;
  }

  const topMuni = Object.entries(muniMap)
    .sort((a, b) => b[1].pos - a[1].pos)
    .slice(0, 10);

  const topGve = Object.entries(gveMap)
    .sort((a, b) => b[1].pos - a[1].pos)
    .slice(0, 10);

  return { totalExam, totalPos, totalTrat, topMuni, topGve, muniCount: Object.keys(muniMap).length };
}

function processTraconet(rows: TraconetRow[]) {
  let tf = 0, ti = 0, ts = 0, tt = 0, co = 0;
  let semForma = 0, comTrat = 0;

  for (const row of rows) {
    const cl = (row.classificacao ?? "").toUpperCase();
    if (cl.includes("TF")) tf++;
    if (cl.includes("TI")) ti++;
    if (cl.includes("TS")) ts++;
    if (cl.includes("TT")) tt++;
    if (cl.includes("CO")) co++;
    if (!cl || cl === "SEM FORMA POSITIVA") semForma++;

    const trat = String(row.tratamento ?? "").toLowerCase();
    if (trat && trat !== "" && trat !== "não" && trat !== "2") comTrat++;
  }

  return { total: rows.length, tf, ti, ts, tt, co, semForma, comTrat };
}

function buildTracomaSummary(
  ano: number,
  nottraconet: ReturnType<typeof processNottraconet>,
  traconet: ReturnType<typeof processTraconet>
): string {
  const hasData = nottraconet.totalExam > 0 || nottraconet.totalPos > 0 || traconet.total > 0;

  if (!hasData) {
    return (
      `AVISO: Não foram encontrados dados de tracoma no sistema SINAN (TRACONET/NOTTRACONET) para o ano ${ano}. ` +
      `Os dados podem ainda não ter sido importados. Gere o boletim informando isso explicitamente ` +
      `e oriente sobre a importância do envio dos dados.`
    );
  }

  const { totalExam, totalPos, totalTrat, topMuni, topGve, muniCount } = nottraconet;
  const { total: totalInd, tf, ti, ts, tt, co, semForma, comTrat } = traconet;

  const topMuniLines = topMuni
    .map(([m, d]) =>
      `${m} | Examinados: ${d.exam} | Positivos: ${d.pos} (${pct(d.pos, d.exam)}) | Tratados: ${d.trat}`
    )
    .join("\n");

  const topGveLines = topGve
    .map(([g, d]) => `${g} | Examinados: ${d.exam} | Positivos: ${d.pos} (${pct(d.pos, d.exam)})`)
    .join("\n");

  const prevAlence = pct(totalPos, totalExam);
  // WHO elimination thresholds
  const elimTF  = totalPos / Math.max(totalExam, 1) < 0.05 ? "ATINGIDA" : "NÃO ATINGIDA";
  const elimTT  = tt / Math.max(totalExam, 1) < 0.002       ? "ATINGIDA" : "NÃO ATINGIDA";

  return `DADOS REAIS DO SINAN — TRACOMA — ANO ${ano}
Estado de São Paulo

━━━ NOTTRACONET — DADOS CONSOLIDADOS MUNICIPAIS ━━━
Total de municípios com dados: ${muniCount}
Total de pessoas examinadas: ${totalExam}
Total de casos positivos (TF+TI): ${totalPos} (prevalência: ${prevAlence})
Total de pessoas tratadas: ${totalTrat} (cobertura de tratamento: ${pct(totalTrat, totalPos)})

━━━ TOP 10 MUNICÍPIOS COM MAIOR NÚMERO DE POSITIVOS ━━━
Município | Examinados | Positivos (prevalência) | Tratados
${topMuniLines}

━━━ DISTRIBUIÇÃO POR GVE — TOP 10 ━━━
GVE | Examinados | Positivos (prevalência)
${topGveLines}

━━━ TRACONET — CASOS INDIVIDUAIS NOTIFICADOS ━━━
Total de notificações individuais: ${totalInd}
Formas clínicas:
  TF (Tracomatoso Folicular — forma ativa): ${tf} (${pct(tf, totalInd)})
  TI (Tracomatoso Inflamatório intenso): ${ti} (${pct(ti, totalInd)})
  TS (Tracomatoso Cicatricial): ${ts} (${pct(ts, totalInd)})
  TT (Triquíase Tracomatosa — cirurgia indicada): ${tt} (${pct(tt, totalInd)})
  CO (Opacidade Corneana): ${co} (${pct(co, totalInd)})
  Sem forma positiva identificada: ${semForma}
Casos com tratamento registrado: ${comTrat} (${pct(comTrat, totalInd)})

━━━ LIMIARES OMS — ELIMINAÇÃO DO TRACOMA ━━━
Meta TF <5% em crianças de 1–9 anos: ${elimTF} (atual: ${prevAlence})
Meta TT <0,2% na população adulta: ${elimTT} (${tt} casos TT em ${totalExam} examinados)`;
}

const SYSTEM_PROMPT = `Você é epidemiologista do Centro de Vigilância Epidemiológica "Prof. Alexandre Vranjac" (CVE/CCD/SES-SP), especialista em doenças oculares e no Programa de Eliminação do Tracoma.
Redige boletins anuais de tracoma para gestores municipais, equipes de vigilância e coordenadores do programa.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores. Se os dados indicarem ausência ou insuficiência de dados, informe isso com clareza e urgência.

Estrutura obrigatória do boletim anual em Markdown:

## Introdução
Descreva: o que é tracoma, agente etiológico (Chlamydia trachomatis), transmissão, classificação clínica SAFE (TF/TI/TS/TT/CO), importância como doença tropical negligenciada, meta OMS de eliminação até 2030 (TF <5% e TT <0,2%), papel de São Paulo como estado endêmico historicamente relevante.

## Resumo Executivo
Um único parágrafo com os números mais importantes do ano — prevalência geral, cobertura de tratamento, status de eliminação. Para o gestor ler em 30 segundos.

## 1. Situação Epidemiológica do Ano
Analise os dados de pessoas examinadas, casos positivos e prevalência. Compare com os limiares OMS.

## 2. Indicadores Anuais

| Indicador | Valor |
|---|---|
| Municípios com dados | X |
| Total examinados | X |
| Total positivos (TF+TI) | X (prevalência Y%) |
| Total tratados | X (cobertura Y%) |
| Notificações individuais (TRACONET) | X |
| Casos TT (cirurgia indicada) | X |

## 3. Distribuição Geográfica
Análise dos municípios e GVEs com maior prevalência. Identifique áreas prioritárias.

## 4. Formas Clínicas
Analise a distribuição das formas clínicas (TF, TI, TS, TT, CO). O predomínio de TT indica necessidade de intervenção cirúrgica.

## 5. Cobertura de Tratamento
Avalie a cobertura de tratamento (meta: tratar 100% dos casos positivos). Identifique lacunas.

## 6. Status de Eliminação (Limiares OMS)
Descreva claramente se o estado atingiu ou não os limiares de eliminação (TF <5%, TT <0,2%).

## 7. Alertas
Use **ALTO**, **MÉDIO** ou **BAIXO** antes de cada item. Se não houver alertas críticos, escreva isso explicitamente.

## 8. Recomendações
Lista numerada com ações concretas para municípios, GVEs e coordenadores do programa estadual.

## Nota Técnica
Fonte: SINAN/TRACONET e NOTTRACONET/SES-SP. Ano de referência dos dados: [ano]. Limitações: cobertura de digitação pode ser incompleta; dados sujeitos a revisão.`;

export async function generateTracomaBulletin(
  options: TracomaBulletinOptions = {}
): Promise<TracomaBulletinResult> {
  const ano = Number(options.ano ?? new Date().getFullYear());
  const supabase = createAdminClient();

  // Trachoma bulletins use se = 0 (annual, not week-based)
  if (!options.force) {
    const { data: existing } = await supabase
      .from("bulletins")
      .select("id, title")
      .eq("se", 0)
      .eq("ano", ano)
      .eq("agravo", "tracoma")
      .maybeSingle();
    if (existing) {
      return { ok: true, skipped: true, id: existing.id, title: existing.title, se: 0, ano, agravo: "tracoma" };
    }
  }

  // Fetch both SINAN banks
  const [{ data: rawNot }, { data: rawTrac }] = await Promise.all([
    supabase
      .from("sinan_tracoma_rows")
      .select("municipio, gve, raw")
      .eq("source_bank", "nottraconet")
      .eq("ano", ano),
    supabase
      .from("sinan_tracoma_rows")
      .select("municipio, gve, classificacao, tratamento")
      .eq("source_bank", "traconet")
      .eq("ano", ano)
  ]);

  const nottraconet = processNottraconet((rawNot ?? []) as NottraconetRow[]);
  const traconet    = processTraconet((rawTrac ?? []) as TraconetRow[]);
  const dataSummary = buildTracomaSummary(ano, nottraconet, traconet);

  const title = `Boletim de Tracoma — Ano ${ano}`;
  const userPrompt = `${dataSummary}\n\nGere o Boletim Epidemiológico Anual de Tracoma para o ano ${ano} seguindo a estrutura definida. Use os números fornecidos acima. Inclua a Introdução completa com o contexto epidemiológico.`;

  let content = "";
  try {
    content = await generateCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt }
      ],
      { temperature: 0.15 }
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), se: 0, ano, agravo: "tracoma" };
  }

  const { data, error } = await supabase
    .from("bulletins")
    .insert({ se: 0, ano, agravo: "tracoma", title, content })
    .select("id, title")
    .single();

  if (error) return { ok: false, error: error.message, se: 0, ano, agravo: "tracoma" };
  return { ok: true, id: data.id, title: data.title, se: 0, ano, agravo: "tracoma" };
}
