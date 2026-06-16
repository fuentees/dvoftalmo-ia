/**
 * Testes de normalização de campos SINAN Tracoma.
 * Valida que variantes de nome de coluna (nomes alternativos do SINAN) são
 * mapeadas corretamente para os campos padronizados internos.
 */
import assert from "node:assert/strict";
import { normalizeSinanTracomaRow } from "@/services/sinan-tracoma";

// ── TRACONET (casos individuais) ─────────────────────────────────────────────

const baseTraconetRow = {
  NU_NOTIFIC: "12345",
  ANO: "2023",
  DT_NOTIFIC: "2023-06-15",
  NM_MUNICIP: "SAO PAULO",
  GVE: "GVE-01",
  DRS: "DRS-01"
};

const t1 = normalizeSinanTracomaRow(baseTraconetRow, "traconet");
assert.equal(t1.ano, 2023, "ano de campo ANO");
assert.equal(t1.municipio, "SAO PAULO", "municipio de NM_MUNICIP");
assert.equal(t1.gve, "GVE-01", "GVE de campo GVE");
assert.equal(t1.source_bank, "traconet", "banco de origem");

// Variantes de nome de coluna para município
const variantMun = normalizeSinanTracomaRow({ ...baseTraconetRow, MUN_NOT: "CAMPINAS", NM_MUNICIP: "" }, "traconet");
assert.equal(variantMun.municipio, "CAMPINAS", "municipio de MUN_NOT quando NM_MUNICIP vazio");

// Variante MUNICIPIO_NOTIFICACAO
const variantMun2 = normalizeSinanTracomaRow({ MUNICIPIO_NOTIFICACAO: "SANTOS", ANO: "2022" }, "traconet");
assert.equal(variantMun2.municipio, "SANTOS", "municipio de MUNICIPIO_NOTIFICACAO");

// Variante GVE_NOME
const variantGve = normalizeSinanTracomaRow({ GVE_NOME: "GVE-LESTE", ANO: "2023" }, "traconet");
assert.equal(variantGve.gve, "GVE-LESTE", "GVE de campo GVE_NOME");

// Variante NM_GVE
const variantGve2 = normalizeSinanTracomaRow({ NM_GVE: "GVE-NORTE", ANO: "2023" }, "traconet");
assert.equal(variantGve2.gve, "GVE-NORTE", "GVE de campo NM_GVE");

// ANO derivado de data quando campo ANO ausente
const derivedAno = normalizeSinanTracomaRow({ DT_NOTIFIC: "2021-03-10", NM_MUNICIP: "OSASCO" }, "traconet");
assert.equal(derivedAno.ano, 2021, "ano derivado de DT_NOTIFIC quando campo ANO ausente");

// ANO_NOTIFIC
const anoNotific = normalizeSinanTracomaRow({ ANO_NOTIFIC: "2020", NM_MUNICIP: "GUARULHOS" }, "traconet");
assert.equal(anoNotific.ano, 2020, "ano de ANO_NOTIFIC");

// NU_ANO
const nuAno = normalizeSinanTracomaRow({ NU_ANO: "2019", NM_MUNICIP: "SOROCABA" }, "traconet");
assert.equal(nuAno.ano, 2019, "ano de NU_ANO");

// Campos nulos quando linha está completamente vazia
const emptyRow = normalizeSinanTracomaRow({}, "traconet");
assert.equal(emptyRow.ano, null, "ano null para linha vazia");
assert.equal(emptyRow.municipio, null, "municipio null para linha vazia");
assert.equal(emptyRow.gve, null, "gve null para linha vazia");
assert.equal(emptyRow.source_bank, "traconet", "source_bank mantido mesmo linha vazia");

// ── NOTTRACONET (consolidado) ─────────────────────────────────────────────────

const baseNottraconetRow = {
  ANO: "2022",
  MUNICIPIO: "RIBEIRAO PRETO",
  GVE_NOME: "GVE-SUL",
  NU_CASOPOS: "5",
  NU_CASOEXA: "120"
};

const n1 = normalizeSinanTracomaRow(baseNottraconetRow, "nottraconet");
assert.equal(n1.ano, 2022, "NOTTRACONET: ano");
assert.equal(n1.municipio, "RIBEIRAO PRETO", "NOTTRACONET: municipio de MUNICIPIO");
assert.equal(n1.gve, "GVE-SUL", "NOTTRACONET: gve de GVE_NOME");
assert.equal(n1.source_bank, "nottraconet", "NOTTRACONET: banco de origem");

// Variante campo MUNICIPIO
const n2 = normalizeSinanTracomaRow({ MUNICIPIO: "BAURU", ANO: "2021" }, "nottraconet");
assert.equal(n2.municipio, "BAURU", "NOTTRACONET: municipio de MUNICIPIO");

// Variante campo REGIONAL para GVE
const n3 = normalizeSinanTracomaRow({ REGIONAL: "GVE-OESTE", ANO: "2021" }, "nottraconet");
assert.equal(n3.gve, "GVE-OESTE", "NOTTRACONET: gve de REGIONAL");

// DRS
const n4 = normalizeSinanTracomaRow({ DRS_NOME: "DRS-XII", ANO: "2021" }, "nottraconet");
assert.equal(n4.drs, "DRS-XII", "NOTTRACONET: drs de DRS_NOME");

// DRS variant
const n5 = normalizeSinanTracomaRow({ NM_DRS: "DRS-VI", ANO: "2021" }, "nottraconet");
assert.equal(n5.drs, "DRS-VI", "NOTTRACONET: drs de NM_DRS");

// Agravo
const n6 = normalizeSinanTracomaRow({ ID_AGRAVO: "A71", ANO: "2022" }, "nottraconet");
assert.equal(n6.agravo, "A71", "agravo de ID_AGRAVO");

const n7 = normalizeSinanTracomaRow({ NM_AGRAVO: "TRACOMA", ANO: "2022" }, "nottraconet");
assert.equal(n7.agravo, "TRACOMA", "agravo de NM_AGRAVO");

// Case insensitive column matching
const caseInsensitive = normalizeSinanTracomaRow({ nm_municip: "JUNDIAI", ano: "2023" }, "traconet");
assert.equal(caseInsensitive.municipio, "JUNDIAI", "case-insensitive: nm_municip em lowercase");
assert.equal(caseInsensitive.ano, 2023, "case-insensitive: ano em lowercase");

// DT_NOTIFICACAO variant (alternative to DT_NOTIFIC)
const dtVariant = normalizeSinanTracomaRow({ DT_NOTIFICACAO: "2022-08-20" }, "traconet");
assert.equal(dtVariant.ano, 2022, "ano derivado de DT_NOTIFICACAO");

// ID_UNIDADE
const unidade = normalizeSinanTracomaRow({ ID_UNIDADE: "CNES-12345", ANO: "2023" }, "traconet");
assert.equal(unidade.unidade, "CNES-12345", "unidade de ID_UNIDADE");

// CNES variant
const cnesVariant = normalizeSinanTracomaRow({ CNES: "0001234", ANO: "2023" }, "traconet");
assert.equal(cnesVariant.unidade, "0001234", "unidade de CNES");

// Classificação
const classi = normalizeSinanTracomaRow({ CLASSI_FIN: "TF", ANO: "2022" }, "nottraconet");
assert.equal(classi.classificacao, "TF", "classificacao de CLASSI_FIN");

// Critério
const criterio = normalizeSinanTracomaRow({ CRITERIO: "Clinico", ANO: "2022" }, "nottraconet");
assert.equal(criterio.criterio, "Clinico", "criterio de CRITERIO");

// TP_CRITERIO variant
const tpCriterio = normalizeSinanTracomaRow({ TP_CRITERIO: "Laboratorial", ANO: "2022" }, "nottraconet");
assert.equal(tpCriterio.criterio, "Laboratorial", "criterio de TP_CRITERIO");

console.log("sinan normalizacao tests passed ✓");
