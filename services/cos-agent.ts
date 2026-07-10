import type { AiSource, TracomaSurveyResult } from "@/lib/types";
import { runCevespAnalysis } from "@/services/cevesp-analytics";
import { fetchTracomaSurveys, estimateAzithromycin } from "@/services/tracoma-analytics";
import { retrieveContext } from "@/services/ai/rag";
import { findInvalidRecords, saveCorrectionsToQueue } from "@/services/cevesp-corrections";
import { getNotificationTableName } from "@/lib/external/notification-db";
import { auditarSinanTracoma, runSinanTracomaAnalysis } from "@/services/sinan-tracoma";
import { runEndemicChannel } from "@/services/cevesp-endemic";
import { extractChartData, type ChartData } from "@/services/ai/chart-utils";

// 5-min in-memory cache for tracoma queries (REDCap is slow and data rarely changes)
const tracomaCache = new Map<string, { data: { data: TracomaSurveyResult[]; isMock: boolean }; expiresAt: number }>();

// ── Data quality: future SE/year filter ──────────────────────────────────────

function currentEpiWeek(): { year: number; se: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const se = Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
  return { year: now.getFullYear(), se };
}

interface DateQualityResult {
  valid: Record<string, unknown>[];
  excluded: number;
  suspicious: number;
  warnings: string[];
}

function validateDates(rows: Record<string, unknown>[]): DateQualityResult {
  if (!rows.length) return { valid: rows, excluded: 0, suspicious: 0, warnings: [] };

  const { year: currentYear, se: currentSe } = currentEpiWeek();
  const cols = Object.keys(rows[0]);

  const yearCol = cols.find((c) => /ano|year/i.test(c) && !/semana|week/i.test(c));
  const seCol   = cols.find((c) => /sem(ana)?epi|semepi|se_|^se$/i.test(c));

  if (!yearCol && !seCol) return { valid: rows, excluded: 0, suspicious: 0, warnings: [] };

  const excluded: Record<string, unknown>[] = [];
  const suspicious: Record<string, unknown>[] = [];
  const valid: Record<string, unknown>[] = [];

  // Earliest plausible year for CEVESP data
  const YEAR_MIN = 1990;
  // Flag as suspicious if older than 5 years (possible typo, e.g. 2006 instead of 2026)
  const SUSPECT_THRESHOLD = currentYear - 5;

  for (const row of rows) {
    const ano = yearCol ? Number(row[yearCol]) : NaN;
    const se  = seCol   ? Number(row[seCol])   : NaN;

    // Exclude: any year in the future, impossible SE, or year before CEVESP existed
    const shouldExclude =
      (!isNaN(ano) && ano > currentYear) ||
      (!isNaN(ano) && !isNaN(se) && ano === currentYear && se > currentSe) ||
      (!isNaN(ano) && ano < YEAR_MIN) ||
      (!isNaN(se)  && (se > 53 || se < 1));

    if (shouldExclude) {
      excluded.push(row);
    } else if (!isNaN(ano) && ano < SUSPECT_THRESHOLD) {
      // Keep in analysis but flag as suspicious
      suspicious.push(row);
      valid.push(row);
    } else {
      valid.push(row);
    }
  }

  const warnings: string[] = [];

  if (excluded.length > 0) {
    const examples = excluded.slice(0, 3).map((r) => {
      const parts: string[] = [];
      if (yearCol) parts.push(`${yearCol}=${r[yearCol]}`);
      if (seCol)   parts.push(`${seCol}=${r[seCol]}`);
      return parts.join(", ");
    });
    warnings.push(
      `EXCLUÍDOS — ${excluded.length} registro(s) com data inválida (futuro ou impossível): ` +
      examples.join(" | ") +
      `. Devem ser corrigidos na fonte (CEVESP/SINAN).`
    );
  }

  if (suspicious.length > 0) {
    // Group by year to summarize
    const byYear: Record<number, number> = {};
    for (const r of suspicious) {
      const y = Number(r[yearCol!]);
      byYear[y] = (byYear[y] ?? 0) + 1;
    }
    const summary = Object.entries(byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([y, n]) => `${y}: ${n} reg.`)
      .join(", ");
    warnings.push(
      `SUSPEITOS (mantidos, mas verifique) — ${suspicious.length} registro(s) com ano anterior a ${SUSPECT_THRESHOLD}, ` +
      `possivelmente erro de digitação (${summary}). ` +
      `Verifique se o ano correto não seria ${currentYear} ou período recente.`
    );
  }

  return { valid, excluded: excluded.length, suspicious: suspicious.length, warnings };
}

// ── Tool executors ────────────────────────────────────────────────────────────

interface ToolResult {
  content: string;
  sources?: AiSource[];
  chart?: ChartData | null;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  if (name === "consultar_cevesp") {
    try {
      const result = await runCevespAnalysis(String(args.pergunta ?? ""));
      if (!result.rows?.length) {
        const diagInfo = Array.isArray(result.interpretation) && result.interpretation.length > 0
          ? result.interpretation.join(" ")
          : "Nenhum dado encontrado para os filtros aplicados.";
        return { content: `CEVESP — sem resultados: ${diagInfo}` };
      }

      const { valid, excluded, suspicious, warnings } = validateDates(result.rows as Record<string, unknown>[]);

      if (!valid.length) {
        return {
          content:
            `Nenhum registro válido retornado. ${excluded} registro(s) foram descartados por data inválida.\n` +
            warnings.join("\n") +
            `\nVerifique se os filtros de data estão corretos.`
        };
      }

      const cols = result.columns ?? Object.keys(valid[0] ?? {});
      const header = cols.join(" | ");
      const rowLines = valid.slice(0, 60).map((r) =>
        cols.map((c) => String(r[c] ?? "")).join(" | ")
      ).join("\n");
      const interp = Array.isArray(result.interpretation)
        ? "\n\nInterpretação: " + result.interpretation.join(" ")
        : "";

      const qualityNote = (excluded > 0 || suspicious > 0)
        ? `\n\n--- Qualidade de dado ---\n` + warnings.join("\n")
        : "";

      const chart = extractChartData(valid, cols, result.metricLabel ?? "Dados", result.timeLabel ?? "");

      return {
        content:
          `Métrica: ${result.metricLabel ?? ""} | Período: ${result.timeLabel ?? ""}\n` +
          `Registros analisados: ${valid.length}` +
          (excluded > 0 ? ` | Excluídos (inválidos): ${excluded}` : "") +
          (suspicious > 0 ? ` | Suspeitos (verificar): ${suspicious}` : "") +
          `\n\n${header}\n${rowLines}${interp}${qualityNote}`,
        chart
      };
    } catch (err) {
      return { content: `Erro CEVESP: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "consultar_canal_endemico") {
    try {
      const points = await runEndemicChannel({
        gve: args.gve ? String(args.gve) : undefined,
        municipality: args.municipio ? String(args.municipio) : undefined,
      });
      const withData = points.filter((p) => p.currentYear !== null);
      if (!withData.length) {
        return { content: "Canal endêmico — sem dados suficientes do ano atual para posicionar a curva." };
      }
      const lastSE = Math.max(...withData.map((p) => p.se));
      const pt = withData.find((p) => p.se === lastSE)!;
      const cur = pt.currentYear!;
      const zona = cur > pt.q3 ? "EPIDEMIA" : cur > pt.q1 ? "ALERTA" : "SUCESSO";
      const weeksAbove = withData.filter((p) => p.currentYear! > p.q3).length;
      return {
        content:
          `Canal endêmico — SE ${lastSE} (ano atual):\n` +
          `Zona: ${zona}\n` +
          `Casos na SE: ${cur}\n` +
          `Q1 histórico (limite sucesso): ${pt.q1}\n` +
          `Mediana histórica (P50): ${pt.median}\n` +
          `Q3 histórico (limite alerta): ${pt.q3}\n` +
          `Semanas acima do Q3 no ano: ${weeksAbove}`
      };
    } catch (err) {
      return { content: `Erro no canal endêmico: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "consultar_tracoma") {
    try {
      const cacheKey = JSON.stringify({
        m: args.municipio ?? null,
        u: args.uf ?? null,
        a: args.ano_inicio ?? null,
        b: args.ano_fim ?? null
      });
      const cached = tracomaCache.get(cacheKey);
      const { data: surveys, isMock } = (cached && Date.now() < cached.expiresAt)
        ? cached.data
        : await fetchTracomaSurveys({
            municipality: args.municipio ? String(args.municipio) : undefined,
            uf: args.uf ? String(args.uf) : undefined,
            yearFrom: args.ano_inicio ? Number(args.ano_inicio) : undefined,
            yearTo: args.ano_fim ? Number(args.ano_fim) : undefined
          }).then((result) => {
            tracomaCache.set(cacheKey, { data: result, expiresAt: Date.now() + 5 * 60_000 });
            return result;
          });
      if (!surveys.length) return { content: "Nenhum dado de tracoma encontrado." };
      const mockWarning = isMock ? "\n\n⚠️ DADOS DE EXEMPLO — REDCap não está configurado. Configure REDCAP_API_URL e REDCAP_API_TOKEN para dados reais." : "";
      const lines = surveys.map((s) =>
        `${s.municipality} (${s.uf}) ${s.examYear}: TF=${s.tfPrevalence.toFixed(1)}% ` +
        `(${s.tfEliminated ? "eliminado" : "acima do limiar OMS"}) | ` +
        `TT=${s.ttPrevalence.toFixed(2)}% (${s.ttEliminated ? "eliminado" : "acima do limiar OMS"}) | ` +
        `Examinados=${s.totalExamined}`
      );
      return { content: `Resultados de tracoma (${surveys.length} municípios/anos):\n` + lines.join("\n") + mockWarning };
    } catch (err) {
      return { content: `Erro tracoma: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "estimar_azitromicina") {
    try {
      const coveragePct = args.cobertura_populacao != null ? Number(args.cobertura_populacao) : 80;
      const estimate = estimateAzithromycin({
        targetPopulation: Number(args.total_examinados),
        coveragePercent: coveragePct
      });
      return {
        content:
          `Estimativa de doses de azitromicina:\n` +
          `- População alvo: ${estimate.population}\n` +
          `- Meta de cobertura: ${estimate.coveragePercent}% → ${estimate.treatmentTarget} pessoas a tratar\n` +
          `- Comprimidos 250 mg (crianças): ${estimate.tablets250mg}\n` +
          `- Comprimidos 500 mg (adultos): ${estimate.tablets500mg}\n` +
          `- Total de comprimidos: ${estimate.totalTablets}\n` +
          estimate.notes.join("\n")
      };
    } catch (err) {
      return { content: `Erro ao estimar doses: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "buscar_documentos") {
    try {
      const ctx = await retrieveContext(String(args.consulta ?? ""), userId);
      if (!ctx.content) return { content: "Nenhum documento relevante encontrado na base de conhecimento." };
      return { content: ctx.content, sources: ctx.sources };
    } catch (err) {
      return { content: `Erro na busca de documentos: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "identificar_invalidos_cevesp") {
    try {
      const limite = Math.min(Number(args.limite ?? 50), 100);
      const records = await findInvalidRecords(limite);
      if (!records.length) return { content: "Nenhum registro com data ou SE inválida encontrado no CEVESP." };
      const lines = records.map((r) =>
        `ID=${r.recordId} | ${r.municipio ?? "?"} | DtNotif=${r.dtNotificacao ?? "?"} | SE=${r.semEpidemio ?? "?"} | Problema: ${r.issue} | Sugestão: ${r.suggestedField}=${r.suggestedValue}`
      );
      return {
        content:
          `Encontrados ${records.length} registros com data/SE inválida:\n` +
          lines.join("\n") +
          `\n\nUse propor_correcao_cevesp para enviar as correções à fila de aprovação.`
      };
    } catch (err) {
      return { content: `Erro ao buscar inválidos: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "consultar_sinan_tracoma") {
    try {
      const result = await runSinanTracomaAnalysis(String(args.pergunta ?? ""));
      if (!result.rows?.length) {
        return { content: `SINAN Tracoma — sem resultados. ${result.interpretation?.join(" ") ?? ""}` };
      }
      const cols = result.columns ?? Object.keys(result.rows[0] ?? {});
      const header = cols.join(" | ");
      const rowLines = result.rows.slice(0, 60).map((r) =>
        cols.map((c) => String(r[c] ?? "")).join(" | ")
      ).join("\n");
      const interp = result.interpretation?.length
        ? "\n\nInterpretação: " + result.interpretation.join(" ")
        : "";
      return {
        content:
          `SINAN Tracoma | ${result.metricLabel ?? ""} | ${result.timeLabel ?? ""}\n` +
          `Total de registros: ${result.rows.find((r) => String(r[cols[0]]) === "Total")?.Valor ?? result.rows.length}\n\n` +
          `${header}\n${rowLines}${interp}`
      };
    } catch (err) {
      return { content: `Erro SINAN Tracoma: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "auditar_sinan_tracoma") {
    try {
      const result = await auditarSinanTracoma({
        municipio: args.municipio ? String(args.municipio) : undefined,
        gve: args.gve ? String(args.gve) : undefined,
        yearStart: args.year_start ? Number(args.year_start) : undefined,
        yearEnd: args.year_end ? Number(args.year_end) : undefined
      });
      const lines: string[] = [
        `=== AUDITORIA SINAN TRACOMA ===`,
        `Total TRACONET (casos individuais): ${result.totalTraconet}`,
        `Total NOTTRACONET/NTRACOMA (casos positivos consolidados): ${result.totalNottraconet}`,
        `Campo de positivos no consolidado: ${result.consolidatedPositiveField ?? "nao identificado"}`,
        `Linhas consolidadas sem positivo mapeado: ${result.consolidatedRowsWithoutPositiveField}`,
        `Possiveis duplicidades do mesmo caso no TRACONET: ${result.duplicateNotificationIds.length} (chave: NU_NOTIFIC + iniciais + mae + nascimento + ano)`,
        `Casos individuais sem ID de notificacao: ${result.missingNotificationId}`
      ];
      if (result.crossBankDivergences.length > 0) {
        lines.push(`\n--- Divergências TRACONET vs NOTTRACONET (${result.crossBankDivergences.length}) ---`);
        for (const d of result.crossBankDivergences.slice(0, 20)) {
          lines.push(`  ${d.municipio} ${d.ano}: individuais=${d.traconet} positivos_consolidados=${d.nottraconet} diff=${d.diff > 0 ? "+" : ""}${d.diff} [risco ${d.risco}]`);
        }
        if (result.crossBankDivergences.length > 20) {
          lines.push(`  ... e mais ${result.crossBankDivergences.length - 20} divergências.`);
        }
      } else {
        lines.push(`\nSem divergências entre TRACONET e NOTTRACONET.`);
      }
      lines.push(`\n--- Completude dos campos ---`);
      for (const [field, stat] of Object.entries(result.fieldCompleteness)) {
        lines.push(`  ${field}: ${stat.filled}/${stat.total} (${stat.pct.toFixed(1)}%)`);
      }
      lines.push(`\n--- Alertas de qualidade ---`);
      lines.push(`  Sem graduação TF/TT: ${result.semGraduacao}`);
      lines.push(`  Sem tratamento: ${result.semTratamento}`);
      lines.push(`  Sem conclusão: ${result.semConclusao}`);
      lines.push(`  TF confirmado sem tratamento: ${result.tfSemTratamento}`);
      lines.push(`  TT confirmado sem cirurgia/epilation: ${result.ttSemCircurgia}`);
      lines.push(`  Registros com ano impossível: ${result.anoImpossivel}`);
      if (result.recommendations.length > 0) {
        lines.push(`\n--- Recomendações ---`);
        result.recommendations.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));
      }
      return { content: lines.join("\n") };
    } catch (err) {
      return { content: `Erro na auditoria SINAN: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (name === "propor_correcao_cevesp") {
    try {
      const tableName = getNotificationTableName();
      const { saved } = await saveCorrectionsToQueue(
        [{
          recordId: String(args.record_id),
          tableName,
          pkColumn: String(args.pk_column),
          fieldName: String(args.field_name),
          oldValue: String(args.old_value),
          newValue: String(args.new_value),
          reason: String(args.reason)
        }],
        userId
      );
      if (saved === 0) {
        return { content: `Correção para registro ${args.record_id} já está na fila aguardando aprovação.` };
      }
      return {
        content:
          `Correção enviada para aprovação: registro ${args.record_id}, ` +
          `campo ${args.field_name}: "${args.old_value}" → "${args.new_value}". ` +
          `Um supervisor precisa aprovar na tela de Fila de Correções antes de ser aplicada.`
      };
    } catch (err) {
      return { content: `Erro ao propor correção: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return { content: `Ferramenta desconhecida: ${name}` };
}
