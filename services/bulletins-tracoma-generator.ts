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
    return `AVISO: Não há dados de tracoma registrados para o ano ${ano}. Informe ao leitor, de forma clara, que não há dados disponíveis para este período. Não mencione sistemas internos. Oriente sobre a importância do envio regular de dados pelos municípios.`;
  }
  const prevalencia = pct(agg.totalPos, agg.totalExam);
  const elimTF = agg.totalPos / Math.max(agg.totalExam, 1) < 0.05 ? "ATINGIDA" : "NÃO ATINGIDA";
  const elimTT = trac.tt / Math.max(agg.totalExam, 1) < 0.002 ? "ATINGIDA" : "NÃO ATINGIDA";

  return `DADOS DE TRACOMA — ANO ${ano} — ESTADO DE SÃO PAULO

━━━ DADOS CONSOLIDADOS MUNICIPAIS ━━━
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

━━━ CASOS INDIVIDUAIS NOTIFICADOS ━━━
Total de casos individuais: ${trac.total}
TF (Folicular): ${trac.tf} (${pct(trac.tf, trac.total)})
TI (Inflamatório Intenso): ${trac.ti} (${pct(trac.ti, trac.total)})
TS (Cicatricial): ${trac.ts}
TT (Triquíase — cirurgia indicada): ${trac.tt}
CO (Opacificação Corneana): ${trac.co}
Casos com tratamento registrado: ${trac.comTrat} (${pct(trac.comTrat, trac.total)})

━━━ LIMIARES OMS ━━━
TF <5%: ${elimTF} (atual: ${prevalencia})
TT <0,2%: ${elimTT} (${trac.tt} casos com triquíase em ${agg.totalExam} examinados)`;
}

// ── Period summary (multi-year) ───────────────────────────────────────────────
function buildPeriodSummary(
  anoInicio: number,
  anoFim: number,
  perYear: Array<{ ano: number; agg: AggResult; trac: TraconetAgg }>
): string {
  const hasAny = perYear.some(y => y.agg.totalExam > 0 || y.trac.total > 0);
  if (!hasAny) {
    return `AVISO: Não há dados de tracoma registrados para o período ${anoInicio}–${anoFim}. Informe ao leitor que não há dados disponíveis para este período. Não mencione sistemas internos.`;
  }

  const trendLines = perYear
    .map(y => {
      const prev = pct(y.agg.totalPos, y.agg.totalExam);
      const cob  = pct(y.agg.totalTrat, y.agg.totalPos);
      return `${y.ano} | ${y.agg.muniCount} municípios | ${y.agg.totalExam} examinados | ${y.agg.totalPos} positivos (${prev}) | ${y.agg.totalTrat} tratados (${cob}) | ${y.trac.total} notificações individuais`;
    })
    .join("\n");

  // Last year details
  const last = perYear[perYear.length - 1];
  const elimTF = last.agg.totalPos / Math.max(last.agg.totalExam, 1) < 0.05 ? "ATINGIDA" : "NÃO ATINGIDA";
  const elimTT = last.trac.tt / Math.max(last.agg.totalExam, 1) < 0.002 ? "ATINGIDA" : "NÃO ATINGIDA";

  return `DADOS DE TRACOMA — PERÍODO ${anoInicio}–${anoFim} — ESTADO DE SÃO PAULO

━━━ TENDÊNCIA POR ANO ━━━
Ano | Municípios | Examinados | Positivos (prev.) | Tratados (cob.) | Notif. individuais
${trendLines}

━━━ SITUAÇÃO NO ANO MAIS RECENTE (${anoFim}) ━━━
Municípios com dados: ${last.agg.muniCount}
Pessoas examinadas: ${last.agg.totalExam}
Positivos (TF+TI): ${last.agg.totalPos} (${pct(last.agg.totalPos, last.agg.totalExam)})
Tratados: ${last.agg.totalTrat} (${pct(last.agg.totalTrat, last.agg.totalPos)})
Casos individuais notificados: ${last.trac.total}
Casos de triquíase (cirurgia indicada): ${last.trac.tt}

━━━ LIMIARES OMS EM ${anoFim} ━━━
TF <5%: ${elimTF} (${pct(last.agg.totalPos, last.agg.totalExam)})
TT <0,2%: ${elimTT}

━━━ MUNICÍPIOS PRIORITÁRIOS (${anoFim}) ━━━
${last.agg.topMuni.map(([m, d]) => `${m} | ${d.exam} exam. | ${d.pos} pos. (${pct(d.pos, d.exam)})`).join("\n")}`;
}

// ── System prompts ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_ANNUAL = `Você é epidemiologista do Centro de Oftalmologia Sanitária / Centro de Vigilância Epidemiológica "Prof. Alexandre Vranjac" (CVE/CCD/SES-SP), especialista em doenças oculares e no Programa Estadual de Eliminação do Tracoma.
Redige boletins epidemiológicos anuais de tracoma destinados a gestores municipais de saúde, coordenadores de GVE (Grupos de Vigilância Epidemiológica) e equipes do Programa de Eliminação do Tracoma.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores. Se não houver dados disponíveis, informe com clareza e oriente sobre o envio regular de informações.

REGRA DE SISTEMAS: Não mencione nomes de sistemas internos de banco de dados. Para referenciar a fonte de dados, use "SINAN/SES-SP", "dados do sistema de vigilância estadual" ou "registros do programa".

REGRA DE ANOS: Use somente o ano de referência informado. Não faça projeções para anos futuros.

REGRA DE FORMATO: NÃO inclua título, subtítulo, cabeçalho institucional ou qualquer linha antes da primeira seção. Comece O TEXTO DIRETAMENTE com "## Introdução".

Estrutura obrigatória em Markdown:

## Introdução
O que é tracoma, agente etiológico (Chlamydia trachomatis), transmissão, classificação clínica (TF — folicular, TI — inflamatório intenso, TS — cicatricial, TT — triquíase, CO — opacificação corneana), importância como doença tropical negligenciada, meta OMS de eliminação até 2030 (TF <5% em escolares e TT <0,2% na população), papel histórico de São Paulo.

## Resumo Executivo
Parágrafo único com os indicadores mais críticos do ano — prevalência, cobertura de tratamento e status de eliminação. Síntese para tomada de decisão rápida.

## Situação Epidemiológica do Ano
Análise dos dados de examinados, positivos e prevalência. Comparação com os limiares OMS. Contextualize a magnitude.

## Indicadores Anuais

| Indicador | Valor |
|---|---|
| Municípios com dados | X |
| Total de pessoas examinadas | X |
| Casos positivos (TF+TI) | X (prevalência: Y%) |
| Pessoas tratadas | X (cobertura: Y%) |
| Casos com triquíase (TT) | X |
| Notificações individuais | X |

## Distribuição Geográfica
Municípios e GVEs com maior prevalência. Áreas prioritárias para intensificação das ações do programa.

## Formas Clínicas
Distribuição dos casos por forma clínica (TF, TI, TS, TT, CO). Destaque para TT — indica necessidade de intervenção cirúrgica imediata.

## Cobertura de Tratamento
Avaliação da cobertura (meta: 100% dos positivos tratados). Municípios com lacunas relevantes.

## Status de Eliminação — Limiares OMS
Avaliação objetiva: o estado atingiu TF <5% e TT <0,2%? Quais municípios ainda apresentam prevalência acima da meta?

## Alertas
Use **ALTO**, **MÉDIO** ou **BAIXO** antes de cada item.
Se não houver alertas críticos, escreva: "Nenhum alerta crítico identificado para o ano de referência."

## Recomendações
Ações concretas e prioritárias para municípios, GVEs e coordenadores do Programa de Eliminação do Tracoma.

## Nota Técnica
Fonte: SINAN/SES-SP. Ano de referência: [ano]. Dados sujeitos a revisão — a cobertura pode ser parcial conforme o período de envio das informações pelos municípios.`;

const SYSTEM_PROMPT_PERIOD = `Você é epidemiologista do Centro de Oftalmologia Sanitária / Centro de Vigilância Epidemiológica "Prof. Alexandre Vranjac" (CVE/CCD/SES-SP), especialista em doenças oculares e no Programa Estadual de Eliminação do Tracoma.
Redige boletins epidemiológicos de análise de período de tracoma destinados a gestores municipais, coordenadores de GVE e equipes do Programa de Eliminação do Tracoma.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores. Se não houver dados para algum ano, informe com clareza.

REGRA DE SISTEMAS: Não mencione nomes de sistemas internos de banco de dados. Use "SINAN/SES-SP", "dados do sistema de vigilância estadual" ou "registros do programa".

REGRA DE ANOS: Use somente os anos do intervalo fornecido. Não faça projeções futuras.

REGRA DE FORMATO: NÃO inclua título, cabeçalho institucional ou qualquer linha antes da primeira seção. Comece DIRETAMENTE com "## Introdução".

Estrutura obrigatória em Markdown:

## Introdução
Contextualização do tracoma em São Paulo, importância do monitoramento multianual, metas OMS de eliminação até 2030 (TF <5%, TT <0,2%) e relevância histórica do estado no controle da doença.

## Resumo do Período
Parágrafo síntese: tendência geral do período, se a prevalência melhorou, piorou ou estabilizou, e status de eliminação no ano mais recente.

## Tendência Epidemiológica

| Ano | Municípios | Examinados | Positivos | Prevalência | Tratados | Cobertura | Notif. Individuais |
|---|---|---|---|---|---|---|---|
(preencha com todos os anos fornecidos nos dados)

## Análise da Tendência
Análise ano a ano: identificar inflexões, anos de piora ou melhora, e possíveis causas (ampliação de cobertura, mudança metodológica, surtos).

## Situação no Ano Mais Recente
Detalhe epidemiológico do último ano do período: municípios, formas clínicas, cobertura de tratamento, áreas prioritárias.

## Municípios Prioritários
Municípios com maior prevalência no último ano disponível — foco para intensificação das ações do programa.

## Status de Eliminação — Limiares OMS
Avaliação do progresso ao longo do período em direção às metas TF <5% e TT <0,2%. O estado está convergindo?

## Alertas
Use **ALTO**, **MÉDIO** ou **BAIXO** antes de cada item.

## Recomendações
Ações concretas considerando a tendência do período inteiro, não apenas o último ano.

## Nota Técnica
Fonte: SINAN/SES-SP. Período de análise: [anoInicio]–[anoFim]. Dados sujeitos a revisão conforme consolidação das informações municipais.`;

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
