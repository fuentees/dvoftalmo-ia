/**
 * Auditoria estrutural CEVESP: compara os registros de uma mesma unidade notificadora
 * entre si para achar duplicidades, semanas trocadas, semanas em branco/futuras e ano
 * digitado errado. As regras de cada registro isolado ficam em services/cevesp-corrections.
 *
 * Fluxo da notificação: a unidade consolida a semana N e notifica durante a semana N+1.
 * Por isso a data de digitação (created_at do MySQL) menos uma semana indica a semana a
 * que o registro provavelmente se refere. Só sugerimos uma semana que esteja vazia para a
 * unidade e que já tivesse terminado quando o registro foi digitado.
 *
 * Funções puras (sem banco) para poderem ser testadas com fixtures.
 */

const DAY_MS = 86_400_000;
/** Distância máxima (semanas) entre digitação e referência para confiar no created_at. */
const CREATED_AT_WINDOW = 4;
/** Registros de anos antigos digitados no mesmo dia acima disto são carga em lote, não digitação. */
const BULK_LOAD_THRESHOLD = 50;
/** Erro de ano: a data informada (dia/mês) cai até 14 dias antes da digitação. */
const YEAR_TYPO_MAX_DAYS = 14;

export const COUNT_FIELDS = [
  "TotalCaso", "FxMenorUmAno", "FxUmQuatro", "FxCincoNove", "FxDezQuatorze",
  "FxQuizeOuMais", "SexMasc", "SexFem", "Surto"
] as const;

export type StructuralProblem =
  | "ano_errado"
  | "se_invalida"
  | "se_futura"
  | "semana_trocada"
  | "duplicata"
  | "duplicata_conflito";

export interface WeekSuggestion { ano: number; se: number }

export interface StructuralFinding {
  problem: StructuralProblem;
  issue: string;
  /** Semana/ano sugeridos; null = revisar manualmente. */
  suggestion: WeekSuggestion | null;
  /** Identifica o grupo de duplicidade (unidade + semana) para exibição. */
  group?: string;
}

export interface AuditRow {
  key: string;
  ANO: number | null;
  SemEpidemio: number | null;
  DtNotificacao: string | null;
  createdAt: string | null;
  unidade: string;
  conteudo: string;
}

// ── Semana epidemiológica em índice contínuo (UTC, sem efeito de horário de verão) ──

function utcDays(year: number, month: number, day: number) {
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** Dia (desde 1970-01-01) do domingo que inicia a SE 1 do ano: semana que contém 4/jan. */
function firstWeekStart(year: number) {
  const jan4 = utcDays(year, 1, 4);
  const dow = new Date(jan4 * DAY_MS).getUTCDay();
  return jan4 - dow;
}

export function weeksInYear(year: number) {
  return (firstWeekStart(year + 1) - firstWeekStart(year)) / 7;
}

/** 1970-01-04 foi domingo (dia 3); o índice conta semanas a partir dele. */
function sundayToIndex(sundayDay: number) {
  return (sundayDay - 3) / 7;
}

export function weekIndex(ano: number, se: number) {
  return sundayToIndex(firstWeekStart(ano) + 7 * (se - 1));
}

export function indexToWeek(index: number): WeekSuggestion {
  const sunday = index * 7 + 3;
  const ano = new Date((sunday + 3) * DAY_MS).getUTCFullYear();
  return { ano, se: (sunday - firstWeekStart(ano)) / 7 + 1 };
}

function parseDate(value: string | null): { y: number; m: number; d: number } | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function dateToIndex(value: string | null): number | null {
  const p = parseDate(value);
  if (!p) return null;
  const days = utcDays(p.y, p.m, p.d);
  const dow = new Date(days * DAY_MS).getUTCDay();
  return sundayToIndex(days - dow);
}

export function isValidWeek(ano: number | null, se: number | null): ano is number {
  return ano != null && se != null && Number.isInteger(ano) && Number.isInteger(se) &&
    ano >= 1990 && se >= 1 && se <= weeksInYear(ano);
}

const fmt = (w: WeekSuggestion) => `SE ${w.se}/${w.ano}`;

// ── Auditoria ───────────────────────────────────────────────────────────────

interface Prepared extends AuditRow {
  idx: number | null;          // semana informada
  createdIdx: number | null;   // semana esperada pela digitação (semana do created_at - 1)
  createdDay: string | null;
  createdYear: number | null;
  dtIdx: number | null;
}

/**
 * Audita um conjunto de registros ativos. Para as regras de vizinhança funcionarem, passe
 * todos os registros das unidades no período (ex.: o ano filtrado e o anterior).
 */
export function auditStructure(rows: AuditRow[], now = new Date()): Map<string, StructuralFinding[]> {
  const findings = new Map<string, StructuralFinding[]>();
  const add = (key: string, f: StructuralFinding) => findings.set(key, [...(findings.get(key) ?? []), f]);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(now);
  const todayIdx = dateToIndex(today)!;

  const prepared: Prepared[] = rows.map((r) => {
    const createdIdx = dateToIndex(r.createdAt);
    return {
      ...r,
      idx: isValidWeek(r.ANO, r.SemEpidemio) ? weekIndex(r.ANO, r.SemEpidemio!) : null,
      createdIdx: createdIdx == null ? null : createdIdx - 1,
      createdDay: r.createdAt?.slice(0, 10) ?? null,
      createdYear: createdIdx == null ? null : indexToWeek(createdIdx).ano,
      dtIdx: dateToIndex(r.DtNotificacao)
    };
  });

  // Semanas ocupadas por unidade (inclui as que serão reservadas pelas sugestões)
  const occupied = new Map<string, Set<number>>();
  for (const r of prepared) {
    if (r.idx == null) continue;
    if (!occupied.has(r.unidade)) occupied.set(r.unidade, new Set());
    occupied.get(r.unidade)!.add(r.idx);
  }
  const isFree = (unidade: string, idx: number) => !occupied.get(unidade)?.has(idx);
  const reserve = (unidade: string, idx: number) => {
    if (!occupied.has(unidade)) occupied.set(unidade, new Set());
    occupied.get(unidade)!.add(idx);
  };
  // Última semana fechada no momento da digitação (ou hoje, sem created_at)
  const lastClosed = (r: Prepared) => r.createdIdx ?? todayIdx - 1;

  /** Primeira semana candidata que é válida, já fechada, livre e do ano exigido. */
  function pick(r: Prepared, candidates: Array<number | null>, ano?: number | null): number | null {
    for (const c of candidates) {
      if (c == null || c > lastClosed(r)) continue;
      if (ano != null && indexToWeek(c).ano !== ano) continue;
      if (!isFree(r.unidade, c)) continue;
      reserve(r.unidade, c);
      return c;
    }
    return null;
  }

  // Carga em lote: muitos registros de anos antigos digitados no mesmo dia
  const oldByDay = new Map<string, number>();
  for (const r of prepared) {
    if (r.createdDay && r.createdYear != null && r.ANO != null && r.ANO < r.createdYear - 1) {
      oldByDay.set(r.createdDay, (oldByDay.get(r.createdDay) ?? 0) + 1);
    }
  }
  const isBulk = (r: Prepared) => r.createdDay != null && (oldByDay.get(r.createdDay) ?? 0) > BULK_LOAD_THRESHOLD;

  const moved = new Set<string>();   // registros com sugestão para sair da semana atual
  const flagged = new Set<string>(); // registros com problema de ano/semana individual

  // Ordem determinística: mais antigos primeiro
  const ordered = [...prepared].sort((a, b) =>
    String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || a.key.localeCompare(b.key));

  // 1) Ano errado
  for (const r of ordered) {
    if (r.createdYear == null || isBulk(r)) continue;
    let motivo: string | null = null;
    if (r.ANO == null) motivo = "ANO não informado";
    else if (r.ANO > r.createdYear) motivo = `ANO ${r.ANO} posterior à digitação (${r.createdDay})`;
    else if (r.ANO < r.createdYear - 1) {
      // Só é erro de digitação se o dia/mês informado cair logo antes da digitação;
      // caso contrário pode ser lançamento atrasado legítimo de um ano antigo.
      const dt = parseDate(r.DtNotificacao);
      const created = parseDate(r.createdDay)!;
      const gap = dt ? utcDays(created.y, created.m, created.d) - utcDays(created.y, dt.m, dt.d) : null;
      if (gap == null || (gap >= 0 && gap <= YEAR_TYPO_MAX_DAYS)) motivo = `ANO ${r.ANO} digitado em ${r.createdDay}`;
    }
    if (!motivo) continue;
    const ano = r.createdYear;
    const informed = r.SemEpidemio != null && r.SemEpidemio >= 1 && r.SemEpidemio <= weeksInYear(ano)
      ? weekIndex(ano, r.SemEpidemio) : null;
    const target = pick(r, [informed, r.createdIdx], ano);
    add(r.key, {
      problem: "ano_errado",
      issue: `Ano errado: ${motivo}`,
      suggestion: target == null ? null : indexToWeek(target)
    });
    flagged.add(r.key);
    if (target != null) moved.add(r.key);
  }

  // 2) SE em branco/inválida e 3) SE futura
  for (const r of ordered) {
    if (flagged.has(r.key)) continue;
    const ano = r.ANO != null && r.ANO >= 1990 ? r.ANO : r.createdYear;
    if (r.idx == null) {
      const target = pick(r, [r.createdIdx, r.dtIdx], ano);
      const se = r.SemEpidemio == null ? "não informada" : String(r.SemEpidemio);
      add(r.key, {
        problem: "se_invalida",
        issue: `SE inválida: ${se}${r.ANO != null && r.SemEpidemio === 53 ? ` (${r.ANO} tem ${weeksInYear(r.ANO)} semanas)` : ""}`,
        suggestion: target == null ? null : indexToWeek(target)
      });
      flagged.add(r.key);
      if (target != null) moved.add(r.key);
    } else if (r.idx > lastClosed(r) + 1) {
      const target = pick(r, [r.createdIdx, r.dtIdx], ano);
      const ref = r.createdIdx != null
        ? `digitado em ${r.createdDay}, ${fmt(indexToWeek(r.createdIdx + 1))}`
        : `SE atual: ${indexToWeek(todayIdx).se}`;
      add(r.key, {
        problem: "se_futura",
        issue: `SE futura: ${r.SemEpidemio} (${ref})`,
        suggestion: target == null ? null : indexToWeek(target)
      });
      flagged.add(r.key);
      if (target != null) moved.add(r.key);
    }
  }

  // 4) Grupos: mesma unidade com mais de um registro na mesma semana
  const groups = new Map<string, Prepared[]>();
  for (const r of ordered) {
    if (r.idx == null || moved.has(r.key)) continue;
    const k = `${r.unidade}#${r.idx}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const n = group[0].idx!;
    const label = `${fmt(indexToWeek(n))} · ${group[0].unidade.split("|").filter(Boolean).pop() ?? ""}`;
    const stay: Prepared[] = [];
    const futureWeek = n > Math.max(...group.map(lastClosed)) + 1;

    // A) a digitação aponta para uma semana vazia próxima
    const viaCreated = group.map((r) =>
      r.createdIdx != null && r.createdIdx !== n &&
      (Math.abs(r.createdIdx - n) <= CREATED_AT_WINDOW || futureWeek) ? r.createdIdx : null);
    let remaining = group.length;
    group.forEach((r, i) => {
      const keepOne = !futureWeek && remaining === 1;
      const target = keepOne ? null : pick(r, [viaCreated[i]]);
      if (target != null) {
        remaining--;
        add(r.key, {
          problem: "semana_trocada",
          issue: `Semana trocada: ${group.length} registros da unidade na ${fmt(indexToWeek(n))}; digitado em ${r.createdDay}, a ${fmt(indexToWeek(target))} está vazia`,
          suggestion: indexToWeek(target),
          group: label
        });
      } else {
        stay.push(r);
      }
    });

    // B) semana vizinha vazia (N+1 para o mais recente, N-1 para o mais antigo)
    if (stay.length > 1) {
      const newest = stay[stay.length - 1];
      if (isFree(newest.unidade, n + 1) && newest.createdIdx != null && newest.createdIdx >= n + 1) {
        reserve(newest.unidade, n + 1);
        stay.pop();
        add(newest.key, {
          problem: "semana_trocada",
          issue: `Semana trocada: ${group.length} registros da unidade na ${fmt(indexToWeek(n))} e a ${fmt(indexToWeek(n + 1))} está vazia`,
          suggestion: indexToWeek(n + 1),
          group: label
        });
      }
    }
    if (stay.length > 1) {
      const oldest = stay[0];
      if (isFree(oldest.unidade, n - 1) && n - 1 <= lastClosed(oldest)) {
        reserve(oldest.unidade, n - 1);
        stay.shift();
        add(oldest.key, {
          problem: "semana_trocada",
          issue: `Semana trocada: ${group.length} registros da unidade na ${fmt(indexToWeek(n))} e a ${fmt(indexToWeek(n - 1))} está vazia`,
          suggestion: indexToWeek(n - 1),
          group: label
        });
      }
    }

    // Restantes: o primeiro fica; os demais são duplicata (sem sugestão automática)
    if (stay.length > 1) {
      const [first, ...extras] = stay;
      for (const r of extras) {
        const hours = first.createdAt && r.createdAt
          ? Math.abs(Date.parse(r.createdAt.replace(" ", "T")) - Date.parse(first.createdAt.replace(" ", "T"))) / 3_600_000
          : null;
        const origem = isBulk(r) ? "carga em lote"
          : hours != null && hours < 1 ? "reenvio em menos de 1h"
          : hours != null ? `reenvio ${Math.round(hours / 24)} dia(s) depois`
          : "reenvio";
        const same = r.conteudo === first.conteudo;
        add(r.key, {
          problem: same ? "duplicata" : "duplicata_conflito",
          issue: same
            ? `Duplicata: mesma unidade e ${fmt(indexToWeek(n))} com os mesmos números (${origem})`
            : `Duplicata com números diferentes: mesma unidade e ${fmt(indexToWeek(n))} (${origem})`,
          suggestion: null,
          group: label
        });
      }
    }
  }

  return findings;
}

/** Chave da unidade notificadora: município + CNES + nome da unidade. */
export function unidadeKey(row: Record<string, unknown>) {
  const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();
  return [norm(row.IbgeNotificacao) || norm(row.MunicipioNotificacao), norm(row.nCNES), norm(row.Unid_notificacao)].join("|");
}

export function conteudoKey(row: Record<string, unknown>) {
  return COUNT_FIELDS.map((f) => row[f] == null || row[f] === "" ? "" : String(Number(row[f]))).join("|");
}
