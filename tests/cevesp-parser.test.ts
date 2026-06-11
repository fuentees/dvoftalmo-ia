import assert from "node:assert/strict";
import { parseCevespQuestionDeterministic } from "@/services/cevesp-analytics";

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

console.log(`CEVESP parser: ${cases.length} casos críticos validados.`);
