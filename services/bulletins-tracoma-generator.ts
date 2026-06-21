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
const SYSTEM_PROMPT_ANNUAL = `Você é comunicador em saúde do Centro de Oftalmologia Sanitária / CVE/SES-SP.
Redige boletins anuais de tracoma para a POPULAÇÃO GERAL — cidadãos e famílias, não gestores ou técnicos.

REGRA DE LINGUAGEM: Clara, acessível e humana. Explique qualquer termo clínico que usar. Sem siglas sem explicação. Sem jargão técnico.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores. Se não houver dados, diga claramente que não há informações disponíveis para o período.

REGRA DE SISTEMAS: Nunca mencione sistemas internos (SINAN, TRACONET, NOTTRACONET, CEVESP, GVE). Use "vigilância estadual de saúde", "dados de São Paulo" ou "registros do programa de controle do tracoma".

REGRA DE ANOS: Nunca mencione anos além do ano de referência. Sem projeções futuras.

REGRA DE PÚBLICO: Não escreva para gestores, municípios ou coordenadores. Escreva para o cidadão.

REGRA DE FORMATO: Comece DIRETAMENTE com "## O que é Tracoma?" sem nenhuma linha antes.

Estrutura obrigatória em Markdown:

## O que é Tracoma?
3–4 frases simples: infecção bacteriana nos olhos causada por uma bactéria (Chlamydia trachomatis), contagiosa pelo contato próximo e por falta de higiene, pode causar cegueira se não tratada, tem cura com tratamento adequado, é considerada doença tropical negligenciada pela OMS.

## Situação em São Paulo — [Ano]
Quantas pessoas foram examinadas, quantos casos foram encontrados, qual a taxa de prevalência — em linguagem simples e empática. Se não há dados disponíveis, informe isso claramente.

## Onde Estão os Casos
Mencione os municípios com mais casos usando os nomes das cidades. Não use siglas administrativas.

## Tratamento
Quantas pessoas receberam tratamento, qual o percentual de cobertura. Se há casos que precisam de cirurgia, mencione de forma simples (casos mais avançados que afetam as pálpebras).

## A Situação Está Melhorando?
Compare brevemente com o contexto histórico disponível nos dados. São Paulo avançando ou recuando na eliminação da doença?

## Sintomas
Lista simples: olho irritado, sensação de areia nos olhos, aparecimento de pequenas saliências na parte interna das pálpebras, lacrimejamento. Em casos mais avançados: pálpebras voltadas para dentro (triquíase), redução da visão.

## Como se Prevenir
Higiene das mãos com frequência, acesso à água limpa, não compartilhar toalhas de rosto, manter o ambiente limpo e ventilado.

## Quando Buscar Atendimento
Procure uma unidade de saúde ou médico se tiver sintomas persistentes nos olhos, especialmente em crianças. O tracoma tem tratamento gratuito pelo SUS.

## Nota
Dados de vigilância epidemiológica do Estado de São Paulo. Ano de referência: [ano].`;

const SYSTEM_PROMPT_PERIOD = `Você é comunicador em saúde do Centro de Oftalmologia Sanitária / CVE/SES-SP.
Redige boletins de período de tracoma para a POPULAÇÃO GERAL — cidadãos e famílias, não gestores ou técnicos.

REGRA DE LINGUAGEM: Clara, acessível e humana. Explique qualquer termo clínico. Sem siglas sem explicação prévia.

REGRA PRINCIPAL: Use SOMENTE os números fornecidos nos dados. Não invente valores.

REGRA DE SISTEMAS: Nunca mencione sistemas internos (SINAN, TRACONET, NOTTRACONET, CEVESP, GVE). Use "vigilância estadual de saúde" ou "dados do programa de controle do tracoma".

REGRA DE ANOS: Nunca mencione anos fora do intervalo informado. Sem projeções futuras.

REGRA DE PÚBLICO: Não escreva para gestores ou coordenadores. Escreva para o cidadão.

REGRA DE FORMATO: Comece DIRETAMENTE com "## O que é Tracoma?" sem nenhuma linha antes.

Estrutura obrigatória em Markdown:

## O que é Tracoma?
3–4 frases simples sobre a doença, transmissão e importância, para quem nunca ouviu falar.

## O que Aconteceu no Período [anoInicio]–[anoFim]
Resumo simples da evolução: a situação melhorou, piorou ou se manteve estável? Dê os números mais importantes de forma narrativa.

## Evolução Ano a Ano
Tabela simples com os dados por ano fornecidos. Colunas: Ano, Municípios Examinados, Casos Encontrados, Prevalência, Tratados.

## Onde Estão os Casos Hoje
Municípios com mais casos no ano mais recente, usando nomes das cidades.

## São Paulo Está Eliminando o Tracoma?
A meta mundial é ter menos de 5% de prevalência. Explique de forma simples se São Paulo está perto ou longe dessa meta.

## Sintomas
Lista simples dos sintomas que o cidadão deve reconhecer.

## Como se Prevenir
Medidas simples de prevenção acessíveis à população.

## Quando Buscar Atendimento
Orientação direta para o cidadão buscar atendimento. Tratamento gratuito pelo SUS.

## Nota
Dados de vigilância epidemiológica do Estado de São Paulo. Período: [anoInicio]–[anoFim].`;

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
