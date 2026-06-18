import { createAdminClient } from "@/lib/supabase/admin";
import { generateCompletion } from "@/services/ai/provider";
import { nomeMunicipio, gvePorCodigo } from "@/lib/municipios-sp";

export interface TracomaBulletinOptions {
  ano?: number;
  anoInicio?: number; // se definido → boletim de período (anoInicio–ano); se não → boletim anual (se=0)
  force?: boolean;
}

export interface TracomaBulletinResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  se: number;
  ano: number;
  agravo: "tracoma";
  title?: string;
  error?: string;
}

// ── Field lookup in raw SINAN JSONB ──────────────────────────────────────────
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

const FIELD = {
  examinados: ["NU_CASOEXA", "CASOEXA", "CASOS_EXAM", "NU_EXAM", "EXAMINADOS", "EXAMINA", "QT_EXAM", "TOT_EXAM", "NU_ALUNOS", "ALUNOS"],
  positivos:  ["NU_CASOPOS", "CASOPOS", "CASOS_POS", "NU_POSITIV", "POSITIVOS", "QT_POS", "TOT_POS"],
  tratados:   ["NU_TRATAD", "TRATADOS", "QT_TRAT", "TOTAL_TRAT"],
};

type NottraconetRow = { municipio: string | null; gve: string | null; raw: Record<string, unknown>; ano?: number };
type TraconetRow   = { municipio: string | null; gve: string | null; classificacao: string | null; tratamento: string | null; ano?: number };

interface AggResult {
  totalExam: number;
  totalPos: number;
  totalTrat: number;
  muniCount: number;
  topMuni: [string, { exam: number; pos: number; trat: number }][];
  topGve: [string, { exam: number; pos: number }][];
}

function processNottraconet(rows: NottraconetRow[]): AggResult {
  let totalExam = 0, totalPos = 0, totalTrat = 0;
  const muniMap: Record<string, { exam: number; pos: number; trat: number }> = {};
  const gveMap:  Record<string, { exam: number; pos: number }> = {};

  for (const row of rows) {
    const raw  = row.raw ?? {};
    const exam = toNum(getValue(raw, FIELD.examinados));
    const pos  = toNum(getValue(raw, FIELD.positivos));
    const trat = toNum(getValue(raw, FIELD.tratados));
    totalExam += exam; totalPos += pos; totalTrat += trat;

    const muni = nomeMunicipio(row.municipio);
    if (!muniMap[muni]) muniMap[muni] = { exam: 0, pos: 0, trat: 0 };
    muniMap[muni].exam += exam; muniMap[muni].pos += pos; muniMap[muni].trat += trat;

    const gve = (row.gve ? String(row.gve).trim() : null) ?? gvePorCodigo(row.municipio) ?? "Não informado";
    if (!gveMap[gve]) gveMap[gve] = { exam: 0, pos: 0 };
    gveMap[gve].exam += exam; gveMap[gve].pos += pos;
  }

  return {
    totalExam, totalPos, totalTrat,
    muniCount: Object.keys(muniMap).length,
    topMuni: Object.entries(muniMap).sort((a, b) => b[1].pos - a[1].pos).slice(0, 10),
    topGve:  Object.entries(gveMap).sort((a, b) => b[1].pos - a[1].pos).slice(0, 10),
  };
}

interface TraconetAgg {
  total: number; tf: number; ti: number; ts: number; tt: number; co: number; semForma: number; comTrat: number;
}

function processTraconet(rows: TraconetRow[]): TraconetAgg {
  let tf = 0, ti = 0, ts = 0, tt = 0, co = 0, semForma = 0, comTrat = 0;
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

// ── Annual summary ────────────────────────────────────────────────────────────
function buildAnnualSummary(ano: number, agg: AggResult, trac: TraconetAgg): string {
  const hasData = agg.totalExam > 0 || agg.totalPos > 0 || trac.total > 0;
  if (!hasData) {
    return `AVISO: Não foram encontrados dados de tracoma no sistema SINAN (TRACONET/NOTTRACONET) para o ano ${ano}. Informe isso com clareza e oriente sobre o envio dos dados.`;
  }
  const prevalencia = pct(agg.totalPos, agg.totalExam);
  const elimTF = agg.totalPos / Math.max(agg.totalExam, 1) < 0.05 ? "ATINGIDA" : "NÃO ATINGIDA";
  const elimTT = trac.tt / Math.max(agg.totalExam, 1) < 0.002 ? "ATINGIDA" : "NÃO ATINGIDA";

  return `DADOS REAIS DO SINAN — TRACOMA — ANO ${ano}
Estado de São Paulo

━━━ NOTTRACONET — DADOS CONSOLIDADOS MUNICIPAIS ━━━
Total de municípios com dados: ${agg.muniCount}
Total de pessoas examinadas: ${agg.totalExam}
Total de casos positivos (TF+TI): ${agg.totalPos} (prevalência: ${prevalencia})
Total de pessoas tratadas: ${agg.totalTrat} (cobertura: ${pct(agg.totalTrat, agg.totalPos)})

━━━ TOP 10 MUNICÍPIOS COM MAIOR NÚMERO DE POSITIVOS ━━━
Município | Examinados | Positivos (prevalência) | Tratados
${agg.topMuni.map(([m, d]) => `${m} | ${d.exam} | ${d.pos} (${pct(d.pos, d.exam)}) | ${d.trat}`).join("\n")}

━━━ DISTRIBUIÇÃO POR GVE — TOP 10 ━━━
GVE | Examinados | Positivos (prevalência)
${agg.topGve.map(([g, d]) => `${g} | ${d.exam} | ${d.pos} (${pct(d.pos, d.exam)})`).join("\n")}

━━━ TRACONET — CASOS INDIVIDUAIS ━━━
Total: ${trac.total}  TF: ${trac.tf} (${pct(trac.tf, trac.total)})  TI: ${trac.ti} (${pct(trac.ti, trac.total)})  TS: ${trac.ts}  TT: ${trac.tt}  CO: ${trac.co}
Casos com tratamento: ${trac.comTrat} (${pct(trac.comTrat, trac.total)})

━━━ LIMIARES OMS ━━━
TF <5%: ${elimTF} (atual: ${prevalencia})
TT <0,2%: ${elimTT} (${trac.tt} casos TT em ${agg.totalExam} examinados)`;
}

// ── Period summary (multi-year) ───────────────────────────────────────────────
function buildPeriodSummary(
  anoInicio: number,
  anoFim: number,
  perYear: Array<{ ano: number; agg: AggResult; trac: TraconetAgg }>
): string {
  const hasAny = perYear.some(y => y.agg.totalExam > 0 || y.trac.total > 0);
  if (!hasAny) {
    return `AVISO: Não foram encontrados dados de tracoma para o período ${anoInicio}–${anoFim}. Informe isso explicitamente.`;
  }

  const trendLines = perYear
    .map(y => {
      const prev = pct(y.agg.totalPos, y.agg.totalExam);
      const cob  = pct(y.agg.totalTrat, y.agg.totalPos);
      return `${y.ano} | ${y.agg.muniCount} municípios | ${y.agg.totalExam} examinados | ${y.agg.totalPos} positivos (${prev}) | ${y.agg.totalTrat} tratados (${cob}) | TRACONET: ${y.trac.total} casos`;
    })
    .join("\n");

  // Last year details
  const last = perYear[perYear.length - 1];
  const elimTF = last.agg.totalPos / Math.max(last.agg.totalExam, 1) < 0.05 ? "ATINGIDA" : "NÃO ATINGIDA";
  const elimTT = last.trac.tt / Math.max(last.agg.totalExam, 1) < 0.002 ? "ATINGIDA" : "NÃO ATINGIDA";

  return `DADOS REAIS DO SINAN — TRACOMA — PERÍODO ${anoInicio}–${anoFim}
Estado de São Paulo

━━━ TENDÊNCIA POR ANO ━━━
Ano | Municípios | Examinados | Positivos (prev.) | Tratados (cob.) | Notif. individuais
${trendLines}

━━━ SITUAÇÃO NO ANO MAIS RECENTE (${anoFim}) ━━━
Municípios com dados: ${last.agg.muniCount}
Pessoas examinadas: ${last.agg.totalExam}
Positivos (TF+TI): ${last.agg.totalPos} (${pct(last.agg.totalPos, last.agg.totalExam)})
Tratados: ${last.agg.totalTrat} (${pct(last.agg.totalTrat, last.agg.totalPos)})
Casos individuais TRACONET: ${last.trac.total}  TT (cirurgia indicada): ${last.trac.tt}

━━━ LIMIARES OMS EM ${anoFim} ━━━
TF <5%: ${elimTF} (${pct(last.agg.totalPos, last.agg.totalExam)})
TT <0,2%: ${elimTT}

━━━ MUNICÍPIOS PRIORITÁRIOS (${anoFim}) ━━━
${last.agg.topMuni.map(([m, d]) => `${m} | ${d.exam} exam. | ${d.pos} pos. (${pct(d.pos, d.exam)})`).join("\n")}`;
}

// ── System prompts ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_ANNUAL = `Você é epidemiologista do Centro de Vigilância Epidemiológica "Prof. Alexandre Vranjac" (CVE/CCD/SES-SP), especialista em doenças oculares e no Programa de Eliminação do Tracoma.
Redige boletins anuais de tracoma para gestores municipais, equipes de vigilância e coordenadores do programa.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores. Se os dados indicarem ausência ou insuficiência de dados, informe isso com clareza e urgência.

REGRA DE FORMATO: NÃO inclua título, subtítulo, cabeçalho institucional, nome da doença, ano de referência ou qualquer linha antes da primeira seção. O documento já possui cabeçalho. Comece O TEXTO DIRETAMENTE com "## Introdução".

Estrutura obrigatória do boletim anual em Markdown (comece exatamente daqui):

## Introdução
Descreva: o que é tracoma, agente etiológico (Chlamydia trachomatis), transmissão, classificação clínica SAFE (TF/TI/TS/TT/CO), importância como doença tropical negligenciada, meta OMS de eliminação até 2030 (TF <5% e TT <0,2%), papel de São Paulo como estado endêmico historicamente relevante.

## Resumo Executivo
Um único parágrafo com os números mais importantes do ano — prevalência geral, cobertura de tratamento, status de eliminação. Para o gestor ler em 30 segundos.

## Situação Epidemiológica do Ano
Analise os dados de pessoas examinadas, casos positivos e prevalência. Compare com os limiares OMS.

## Indicadores Anuais

| Indicador | Valor |
|---|---|
| Municípios com dados | X |
| Total examinados | X |
| Total positivos (TF+TI) | X (prevalência Y%) |
| Total tratados | X (cobertura Y%) |
| Notificações individuais (TRACONET) | X |
| Casos TT (cirurgia indicada) | X |

## Distribuição Geográfica
Análise dos municípios e GVEs com maior prevalência. Identifique áreas prioritárias.

## Formas Clínicas
Analise a distribuição das formas clínicas (TF, TI, TS, TT, CO). O predomínio de TT indica necessidade de intervenção cirúrgica.

## Cobertura de Tratamento
Avalie a cobertura de tratamento (meta: tratar 100% dos casos positivos). Identifique lacunas.

## Status de Eliminação — Limiares OMS
Descreva claramente se o estado atingiu ou não os limiares de eliminação (TF <5%, TT <0,2%).

## Alertas
Use **ALTO**, **MÉDIO** ou **BAIXO** antes de cada item. Se não houver alertas críticos, escreva isso explicitamente.

## Recomendações
Lista com ações concretas para municípios, GVEs e coordenadores do programa estadual.

## Nota Técnica
Fonte: SINAN/TRACONET e NOTTRACONET/SES-SP. Ano de referência dos dados: [ano]. Limitações: cobertura de digitação pode ser incompleta; dados sujeitos a revisão.`;

const SYSTEM_PROMPT_PERIOD = `Você é epidemiologista do Centro de Vigilância Epidemiológica "Prof. Alexandre Vranjac" (CVE/CCD/SES-SP), especialista em doenças oculares e no Programa de Eliminação do Tracoma.
Redige boletins de ANÁLISE DE PERÍODO de tracoma para gestores municipais e coordenadores do programa.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores.

REGRA DE FORMATO: NÃO inclua título, cabeçalho institucional ou qualquer linha antes da primeira seção. Comece DIRETAMENTE com "## Introdução".

Estrutura obrigatória do boletim de período em Markdown (comece exatamente daqui):

## Introdução
Contextualização do tracoma no Estado de São Paulo, importância do monitoramento multianual, metas OMS de eliminação até 2030 (TF <5%, TT <0,2%) e relevância histórica de SP no controle da doença.

## Resumo do Período
Parágrafo síntese: tendência geral observada no período, se a prevalência melhorou/piorou/estabilizou, e status atual de eliminação no ano mais recente.

## Tendência Epidemiológica

| Ano | Municípios | Examinados | Positivos | Prevalência | Tratados | Cobertura | Notif. (TRACONET) |
|---|---|---|---|---|---|---|---|
(preencha com os dados de cada ano fornecidos)

## Análise da Tendência
Analise a evolução ano a ano. Identifique anos de piora ou melhora. Destaque mudanças significativas.

## Situação no Ano Mais Recente
Detalhe a situação epidemiológica do último ano do período. Inclua distribuição geográfica, formas clínicas e cobertura de tratamento.

## Municípios Prioritários
Baseado no último ano disponível, liste os municípios com maior prevalência que precisam de atenção imediata.

## Status de Eliminação — Limiares OMS
Avalie o progresso rumo às metas de eliminação ao longo do período. O estado está convergindo para TF <5% e TT <0,2%?

## Alertas
Use **ALTO**, **MÉDIO** ou **BAIXO** antes de cada item.

## Recomendações
Ações concretas considerando a tendência do período inteiro, não apenas o último ano.

## Nota Técnica
Fonte: SINAN/TRACONET e NOTTRACONET/SES-SP. Período de análise: [anoInicio]–[anoFim]. Dados sujeitos a revisão.`;

// ── Main generator ─────────────────────────────────────────────────────────────
export async function generateTracomaBulletin(
  options: TracomaBulletinOptions = {}
): Promise<TracomaBulletinResult> {
  const anoFim   = Number(options.ano ?? new Date().getFullYear());
  const anoInicio = options.anoInicio != null ? Number(options.anoInicio) : undefined;
  const isPeriod  = anoInicio != null && anoInicio < anoFim;

  // se=0 for annual, se=anoInicio for period
  const seValue = isPeriod ? anoInicio! : 0;
  const supabase = createAdminClient();

  // Idempotency check
  if (!options.force) {
    const { data: existing } = await supabase
      .from("bulletins")
      .select("id, title")
      .eq("se", seValue)
      .eq("ano", anoFim)
      .eq("agravo", "tracoma")
      .maybeSingle();
    if (existing) {
      return { ok: true, skipped: true, id: existing.id, title: existing.title, se: seValue, ano: anoFim, agravo: "tracoma" };
    }
  }

  let dataSummary: string;
  let title: string;
  let userPrompt: string;
  let systemPrompt: string;

  if (isPeriod) {
    // Fetch data for each year in the range
    const anos = Array.from({ length: anoFim - anoInicio! + 1 }, (_, i) => anoInicio! + i);
    const perYear: Array<{ ano: number; agg: AggResult; trac: TraconetAgg }> = [];

    await Promise.all(
      anos.map(async (ano) => {
        const [{ data: rawNot }, { data: rawTrac }] = await Promise.all([
          supabase.from("sinan_tracoma_rows").select("municipio, gve, raw").eq("source_bank", "nottraconet").eq("ano", ano),
          supabase.from("sinan_tracoma_rows").select("municipio, gve, classificacao, tratamento").eq("source_bank", "traconet").eq("ano", ano),
        ]);
        perYear.push({
          ano,
          agg: processNottraconet((rawNot ?? []) as NottraconetRow[]),
          trac: processTraconet((rawTrac ?? []) as TraconetRow[]),
        });
      })
    );

    perYear.sort((a, b) => a.ano - b.ano);
    dataSummary = buildPeriodSummary(anoInicio!, anoFim, perYear);
    title = `Boletim de Tracoma — Período ${anoInicio}–${anoFim}`;
    systemPrompt = SYSTEM_PROMPT_PERIOD;
    userPrompt = `${dataSummary}\n\nGere o Boletim Epidemiológico de Tracoma para o período ${anoInicio}–${anoFim} seguindo a estrutura definida. Use exclusivamente os dados fornecidos.`;
  } else {
    // Annual
    const [{ data: rawNot }, { data: rawTrac }] = await Promise.all([
      supabase.from("sinan_tracoma_rows").select("municipio, gve, raw").eq("source_bank", "nottraconet").eq("ano", anoFim),
      supabase.from("sinan_tracoma_rows").select("municipio, gve, classificacao, tratamento").eq("source_bank", "traconet").eq("ano", anoFim),
    ]);
    const agg  = processNottraconet((rawNot ?? []) as NottraconetRow[]);
    const trac = processTraconet((rawTrac ?? []) as TraconetRow[]);
    dataSummary  = buildAnnualSummary(anoFim, agg, trac);
    title        = `Boletim de Tracoma — Ano ${anoFim}`;
    systemPrompt = SYSTEM_PROMPT_ANNUAL;
    userPrompt   = `${dataSummary}\n\nGere o Boletim Epidemiológico Anual de Tracoma para o ano ${anoFim} seguindo a estrutura definida. Inclua a Introdução completa.`;
  }

  let content = "";
  try {
    content = await generateCompletion(
      [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      { temperature: 0.15 }
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), se: seValue, ano: anoFim, agravo: "tracoma" };
  }

  const { data, error } = await supabase
    .from("bulletins")
    .upsert({ se: seValue, ano: anoFim, agravo: "tracoma", title, content }, { onConflict: "se,ano,agravo" })
    .select("id, title")
    .single();

  if (error) return { ok: false, error: error.message, se: seValue, ano: anoFim, agravo: "tracoma" };
  return { ok: true, id: data.id, title: data.title, se: seValue, ano: anoFim, agravo: "tracoma" };
}
