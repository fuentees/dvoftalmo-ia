import assert from "node:assert/strict";
import { parseCevespQuestionDeterministic, prepareDemographicMetricRows, mysqlExclusionSql } from "@/services/cevesp-analytics";
import { excluidoFlag } from "@/lib/cevesp-clean";

const cases = [
  {
    name: "municipio Sao Paulo, ultimos 5 anos, por ano",
    question: "quantos casos no municipio SAO PAULO nos ultimos 5 anos separado por ano?",
    expected: {
      metric: "total_casos",
      time_grain: "year",
      dateType: "relative_years",
      amount: 5,
      filterField: "municipio",
      filterValue: "sao paulo"
    }
  },
  {
    name: "relatorio mensal por GVE dos ultimos 5 anos",
    question: "relatorio mensal do total de casos por GVE dos ultimos 5 anos",
    expected: {
      metric: "total_casos",
      time_grain: "month",
      dateType: "relative_years",
      amount: 5,
      dimension: "gve"
    }
  },
  {
    name: "surto no ano atual",
    question: "teve surto esse ano?",
    expected: {
      metric: "surtos",
      time_grain: "none",
      dateType: "current_year"
    }
  },
  {
    name: "semana epidemiologica por municipio",
    question: "total de casos por semana epidemiologica no municipio de Campinas nos ultimos 12 meses",
    expected: {
      metric: "total_casos",
      time_grain: "week",
      dateType: "relative_months",
      amount: 12,
      filterField: "municipio",
      filterValue: "campinas"
    }
  },
  {
    name: "DRS por ano",
    question: "notificacoes por DRS por ano nos ultimos 3 anos",
    expected: {
      metric: "notificacoes",
      time_grain: "year",
      dateType: "relative_years",
      amount: 3,
      dimension: "drs"
    }
  },
  {
    name: "ano explicito por municipio",
    question: "casos em 2024 por municipio",
    expected: {
      metric: "total_casos",
      time_grain: "none",
      dateType: "between",
      start: "2024-01-01",
      end: "2024-12-31",
      dimension: "municipio"
    }
  },
  {
    name: "periodo entre anos por GVE",
    question: "ranking de GVE de 2021 a 2025 por total de casos",
    expected: {
      metric: "total_casos",
      time_grain: "none",
      dateType: "between",
      start: "2021-01-01",
      end: "2025-12-31",
      dimension: "gve"
    }
  },
  {
    name: "distribuicao por sexo",
    question: "distribuicao por sexo no ano passado",
    expected: {
      metric: "total_casos",
      time_grain: "none",
      dateType: "last_year"
    }
  },
  {
    name: "faixa etaria",
    question: "qual a distribuicao por faixa etaria esse ano?",
    expected: {
      metric: "total_casos",
      time_grain: "none",
      dateType: "current_year"
    }
  },
  {
    name: "top 10 municipios com mais surtos",
    question: "top 10 municipios com mais surtos em 2025",
    expected: {
      metric: "surtos",
      time_grain: "none",
      dateType: "between",
      start: "2025-01-01",
      end: "2025-12-31",
      dimension: "municipio",
      limit: 10
    }
  },
  {
    name: "coletas por unidade notificadora",
    question: "coletas biologicas por unidade notificadora nos ultimos 6 meses",
    expected: {
      metric: "coletas",
      time_grain: "none",
      dateType: "relative_months",
      amount: 6,
      dimension: "unidade"
    }
  },
  {
    name: "fevereiro com ultimo dia valido",
    question: "casos em fevereiro de 2024 por municipio",
    expected: {
      metric: "total_casos",
      time_grain: "none",
      dateType: "between",
      start: "2024-02-01",
      end: "2024-02-29",
      dimension: "municipio"
    }
  },
  {
    name: "planilha basica municipio por ano",
    question: "gere uma planilha basica de casos por municipio e ano dos ultimos 5 anos",
    expected: {
      metric: "total_casos",
      time_grain: "year",
      dateType: "relative_years",
      amount: 5,
      dimension: "municipio"
    }
  },
  {
    name: "casos por gve de quatro anos",
    question: "casos por gve dos ultimos 4 anos em tabela",
    expected: {
      metric: "total_casos",
      time_grain: "year",
      dateType: "relative_years",
      amount: 4,
      dimension: "gve"
    }
  },
  {
    name: "periodo livre por gve mensal",
    question: "total de casos por GVE entre 2021 e 2025 por mes",
    expected: {
      metric: "total_casos",
      time_grain: "month",
      dateType: "between",
      start: "2021-01-01",
      end: "2025-12-31",
      dimension: "gve"
    }
  },
  {
    name: "surto este ano por municipio",
    question: "teve surto este ano por municipio?",
    expected: {
      metric: "surtos",
      time_grain: "none",
      dateType: "current_year",
      dimension: "municipio"
    }
  }
];

for (const item of cases) {
  const parsed = parseCevespQuestionDeterministic(item.question);
  assert.equal(parsed.metric, item.expected.metric, item.name);
  assert.equal(parsed.time_grain, item.expected.time_grain, item.name);
  assert.equal(parsed.date_range.type, item.expected.dateType, item.name);

  if ("amount" in item.expected) {
    assert.equal(parsed.date_range.amount, item.expected.amount, item.name);
  }
  if ("start" in item.expected) {
    assert.equal(parsed.date_range.start, item.expected.start, item.name);
  }
  if ("end" in item.expected) {
    assert.equal(parsed.date_range.end, item.expected.end, item.name);
  }
  if ("dimension" in item.expected) {
    assert.ok(parsed.dimensions.includes(item.expected.dimension as never), item.name);
  }
  if ("limit" in item.expected) {
    assert.equal(parsed.limit, item.expected.limit, item.name);
  }
  if ("filterField" in item.expected) {
    const filter = parsed.filters.find((candidate) => candidate.field === item.expected.filterField);
    assert.ok(filter, item.name);
    assert.equal(filter?.value, item.expected.filterValue, item.name);
  }
}

const cancelled = [{ Municipio: "A", valor: 20, __demo_total: 20, __demo_informed: 20, __demo_invalid_rows: 1 }];
assert.deepEqual(prepareDemographicMetricRows("sexo_masculino", cancelled).rows, [], "A plausible selected metric must not hide errors within its source records");
assert.equal(prepareDemographicMetricRows("sexo_feminino", [{ valor: 10 }]).blocked, true, "Missing row validation must not certify a demographic metric");
const partialMetric = prepareDemographicMetricRows("faixa_1_4", [{ Ano: 2026, valor: 3, __demo_total: 10, __demo_informed: 5, __demo_invalid_rows: 0 }]);
assert.deepEqual(partialMetric.rows, [{ Ano: 2026, valor: 3 }]);
assert.ok(partialMetric.warnings.some(warning => warning.includes("sem distribuição completa")));
assert.equal(partialMetric.blocked, false);
assert.equal(prepareDemographicMetricRows("sexo_masculino", [{ valor: 0, __demo_total: 0, __demo_informed: 0, __demo_invalid_rows: 0 }]).blocked, false);
assert.deepEqual(prepareDemographicMetricRows("total_casos", [{ valor: 10 }]).rows, [{ valor: 10 }]);
const activeSql = mysqlExclusionSql();
const excludedSql = mysqlExclusionSql(true);
assert.equal(activeSql.where, `NOT (${excludedSql.where})`, "Active and excluded queries must use complementary predicates");
assert.ok(excludedSql.countExpression.includes(excludedSql.where), "The excluded metric must count the same flags that its WHERE selects");
assert.doesNotMatch(activeSql.where, /coalesce\(Excluido, 0\)/i, "String S must never be converted to numeric zero in MySQL");
const sqlFlags = Array.from(excludedSql.where.matchAll(/'([^']*)'/g), match => match[1]).filter(Boolean);
for (const [value, expected] of [["S", 1], [" s ", 1], ["N", 0], ["1", 1], [1, 1], ["0", 0], [0, 0], [null, 0], [true, 1]] as const) {
  assert.equal(sqlFlags.includes(String(value ?? "").trim().toUpperCase()) ? 1 : 0, expected);
  assert.equal(excluidoFlag(value), expected, "MySQL query flags must match the cache normalization contract");
}
console.log(`CEVESP parser: ${cases.length} casos críticos e validação de métricas demográficas verificados.`);
