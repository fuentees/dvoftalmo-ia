/**
 * Testes de validação de datas e conteúdo CEVESP.
 * Usa mapInvalidCacheRow para verificar que inconsistências são detectadas
 * corretamente sem precisar de banco de dados.
 */
import assert from "node:assert/strict";
import { mapInvalidCacheRow } from "@/services/cevesp-corrections";

const currentYear = new Date().getFullYear();
const futureYear = currentYear + 1;
const pastImpossibleYear = 1985;

// ── Datas ────────────────────────────────────────────────────────────────────

// Data futura
const futureDate = mapInvalidCacheRow({
  DtNotificacao: `${futureYear}-03-15`,
  SemEpidemio: 11,
  MunicipioNotificacao: "SAO PAULO",
  GVE_NOME: "GVE-01",
  TotalCaso: 5,
  SexMasc: 3, SexFem: 2,
  FxUmQuatro: 2, FxCincoNove: 3
});
assert.ok(futureDate !== null, "data futura deve ser inválida");
assert.ok(futureDate!.issue.startsWith("Data futura"), `esperado 'Data futura', obtido: '${futureDate!.issue}'`);
assert.equal(futureDate!.issueType, "data_tempo", "data futura é tipo data_tempo");
assert.equal(futureDate!.suggestedField, "DtNotificacao", "campo sugerido para data futura");

// Ano impossível (< 1990)
const impossibleYear = mapInvalidCacheRow({
  DtNotificacao: `${pastImpossibleYear}-06-10`,
  SemEpidemio: 24,
  MunicipioNotificacao: "CAMPINAS",
  GVE_NOME: "GVE-02",
  TotalCaso: 3,
  SexMasc: 2, SexFem: 1,
  FxCincoNove: 3
});
assert.ok(impossibleYear !== null, "ano impossível deve ser inválido");
assert.ok(impossibleYear!.issue.startsWith("Ano impossível"), `esperado 'Ano impossível', obtido: '${impossibleYear!.issue}'`);
assert.equal(impossibleYear!.issueType, "data_tempo", "ano impossível é tipo data_tempo");

// ── Semana epidemiológica ────────────────────────────────────────────────────

// SE acima de 53 (inválida)
const highSe = mapInvalidCacheRow({
  DtNotificacao: `${currentYear}-01-10`,
  SemEpidemio: 54,
  MunicipioNotificacao: "SANTOS",
  GVE_NOME: "GVE-03",
  TotalCaso: 2
});
assert.ok(highSe !== null, "SE > 53 deve ser inválida");
assert.ok(highSe!.issue.startsWith("SE inválida"), `esperado 'SE inválida', obtido: '${highSe!.issue}'`);
assert.equal(highSe!.issueType, "data_tempo");
assert.equal(highSe!.suggestedField, "SemEpidemio");

// SE zero (inválida)
const zeroSe = mapInvalidCacheRow({
  DtNotificacao: `${currentYear}-02-05`,
  SemEpidemio: 0,
  MunicipioNotificacao: "OSASCO",
  GVE_NOME: "GVE-04",
  TotalCaso: 1
});
assert.ok(zeroSe !== null, "SE = 0 deve ser inválida");
assert.ok(zeroSe!.issue.startsWith("SE inválida"), `SE zero: '${zeroSe!.issue}'`);

// ── Território ───────────────────────────────────────────────────────────────

// Município ausente
const noMunicipio = mapInvalidCacheRow({
  DtNotificacao: `${currentYear}-05-20`,
  SemEpidemio: 20,
  MunicipioNotificacao: "",
  GVE_NOME: "GVE-05",
  TotalCaso: 4
});
assert.ok(noMunicipio !== null, "município ausente deve ser inválido");
assert.ok(noMunicipio!.issue.includes("Município ausente"), `'${noMunicipio!.issue}'`);
assert.equal(noMunicipio!.issueType, "conteudo");

// GVE ausente
const noGve = mapInvalidCacheRow({
  DtNotificacao: `${currentYear}-04-10`,
  SemEpidemio: 15,
  MunicipioNotificacao: "GUARULHOS",
  GVE_NOME: null,
  TotalCaso: 2
});
assert.ok(noGve !== null, "GVE ausente deve ser inválido");
assert.ok(noGve!.issue.includes("GVE ausente"), `'${noGve!.issue}'`);

// ── Contagem de casos ────────────────────────────────────────────────────────

// TotalCaso null
const nullTotal = mapInvalidCacheRow({
  DtNotificacao: `${currentYear}-03-01`,
  SemEpidemio: 9,
  MunicipioNotificacao: "SOROCABA",
  GVE_NOME: "GVE-06",
  TotalCaso: null
});
assert.ok(nullTotal !== null, "TotalCaso null deve ser inválido");
assert.ok(nullTotal!.issue.includes("não informado") || nullTotal!.issue.includes("TotalCaso"), `'${nullTotal!.issue}'`);

// TotalCaso negativo
const negTotal = mapInvalidCacheRow({
  DtNotificacao: `${currentYear}-03-01`,
  SemEpidemio: 9,
  MunicipioNotificacao: "SOROCABA",
  GVE_NOME: "GVE-06",
  TotalCaso: -1
});
assert.ok(negTotal !== null, "TotalCaso negativo deve ser inválido");
assert.ok(negTotal!.issue.startsWith("Total de casos negativo"), `'${negTotal!.issue}'`);
assert.equal(negTotal!.suggestedField, "TotalCaso");
assert.equal(negTotal!.suggestedValue, "0");

// ── Divergências de faixa etária e sexo ─────────────────────────────────────

// TotalCaso = 0 mas soma das faixas > 0
// Usar ano anterior para evitar conflito com SE futura
const prevYear = currentYear - 1;
const faixaDiverge = mapInvalidCacheRow({
  DtNotificacao: `${prevYear}-07-10`,
  SemEpidemio: 28,
  MunicipioNotificacao: "JUNDIAI",
  GVE_NOME: "GVE-07",
  TotalCaso: 0,
  FxUmQuatro: 2, FxCincoNove: 1,
  SexMasc: 0, SexFem: 0
});
assert.ok(faixaDiverge !== null, "faixa etária divergente (TotalCaso=0, faixa>0)");
assert.ok(faixaDiverge!.issue.includes("faixa") || faixaDiverge!.issue.toLowerCase().includes("faixa"), `'${faixaDiverge!.issue}'`);

// TotalCaso > 0 mas SexMasc + SexFem ≠ TotalCaso
const sexoDiverge = mapInvalidCacheRow({
  DtNotificacao: `${prevYear}-08-01`,
  SemEpidemio: 31,
  MunicipioNotificacao: "BAURU",
  GVE_NOME: "GVE-08",
  TotalCaso: 10,
  SexMasc: 3, SexFem: 3,  // soma = 6 ≠ 10
  FxCincoNove: 5, FxDezQuatorze: 5
});
assert.ok(sexoDiverge !== null, "sexo divergente (Masc+Fem ≠ TotalCaso)");
assert.ok(sexoDiverge!.issue.toLowerCase().includes("sexo"), `'${sexoDiverge!.issue}'`);

// ── Registro válido — deve retornar null ────────────────────────────────────
// Usar ano anterior para evitar qualquer conflito de SE futura

const validRecord = mapInvalidCacheRow({
  DtNotificacao: `${prevYear}-03-01`,
  SemEpidemio: 9,
  MunicipioNotificacao: "RIBEIRAO PRETO",
  GVE_NOME: "GVE-09",
  TotalCaso: 4,
  SexMasc: 2, SexFem: 2,
  FxCincoNove: 2, FxDezQuatorze: 2,
  FxMenorUmAno: 0, FxUmQuatro: 0, FxQuizeOuMais: 0
});
assert.equal(validRecord, null, "registro válido não deve ser retornado como inválido");

console.log("cevesp validacao tests passed ✓");
