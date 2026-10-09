/**
 * Auditoria CEVESP por unidade notificadora: duplicidade, semana trocada, SE em branco,
 * SE futura e ano errado. Os casos reproduzem registros reais encontrados no MySQL.
 */
import assert from "node:assert/strict";
import { auditStructure, indexToWeek, weekIndex, weeksInYear, type AuditRow } from "@/lib/cevesp-audit";
import { cleanRow, excluidoFlag, rowKey } from "@/lib/cevesp-clean";
import { auditCevespRows } from "@/services/cevesp-corrections";

const NOW = new Date("2026-10-08T15:00:00-03:00"); // SE 40/2026

let seq = 0;
function row(p: Partial<AuditRow> & { ANO: number | null; SemEpidemio: number | null; createdAt: string | null }): AuditRow {
  return { key: String(++seq), DtNotificacao: null, unidade: "350000||UBS TESTE", conteudo: "0|0|0|0|0|0|0|0|0", ...p };
}
/** Semanas 1..last ocupadas, exceto as listadas, para isolar a regra testada. */
function filledWeeks(last: number, except: number[] = [], unidade = "350000||UBS TESTE") {
  return Array.from({ length: last }, (_, i) => i + 1)
    .filter((se) => !except.includes(se))
    .map((se) => row({ ANO: 2026, SemEpidemio: se, createdAt: null, unidade }));
}
const audit = (rows: AuditRow[]) => auditStructure(rows, NOW);

// ── Semana epidemiológica contínua ───────────────────────────────────────────
assert.equal(weeksInYear(2025), 53);
assert.equal(weeksInYear(2026), 52);
assert.deepEqual(indexToWeek(weekIndex(2025, 53) + 1), { ano: 2026, se: 1 });
assert.deepEqual(indexToWeek(weekIndex(2026, 1) - 1), { ano: 2025, se: 53 });

// ── SE futura: SE 44 digitada em julho vira a SE anterior à digitação (26) ──
{
  const r = row({ ANO: 2026, SemEpidemio: 44, createdAt: "2026-07-06 04:56:07" });
  const f = audit([...filledWeeks(40, [26]), r]).get(r.key)!;
  assert.equal(f[0].problem, "se_futura");
  assert.deepEqual(f[0].suggestion, { ano: 2026, se: 26 });
}

// ── SE em branco: sugere a semana anterior à digitação, se estiver livre ──
{
  const r = row({ ANO: 2026, SemEpidemio: 0, createdAt: "2026-10-05 11:22:31" });
  const f = audit([...filledWeeks(38), r]).get(r.key)!;
  assert.equal(f[0].problem, "se_invalida");
  assert.deepEqual(f[0].suggestion, { ano: 2026, se: 39 });

  // Semana anterior já ocupada e sem DtNotificacao: não inventa semana
  const ocupada = row({ ANO: 2026, SemEpidemio: 0, createdAt: "2026-10-05 11:22:31" });
  assert.equal(audit([...filledWeeks(39), ocupada]).get(ocupada.key)![0].suggestion, null);
}

// ── SE 53 não existe em 2026 ──
{
  const r = row({ ANO: 2026, SemEpidemio: 53, createdAt: "2026-03-10 10:00:00" });
  assert.match(audit([r]).get(r.key)![0].issue, /SE inválida: 53 \(2026 tem 52 semanas\)/);
}

// ── Ano errado: 2023 digitado em 2026 com dia/mês iguais ──
{
  const r = row({ ANO: 2023, SemEpidemio: 10, DtNotificacao: "2023-03-16", createdAt: "2026-03-16 11:27:16" });
  const f = audit([r]).get(r.key)!;
  assert.equal(f[0].problem, "ano_errado");
  assert.deepEqual(f[0].suggestion, { ano: 2026, se: 10 });

  const futuro = row({ ANO: 2027, SemEpidemio: 24, DtNotificacao: "2026-06-15", createdAt: "2026-08-24 17:06:02" });
  assert.deepEqual(audit([futuro]).get(futuro.key)![0].suggestion, { ano: 2026, se: 24 });

  // Lançamento atrasado legítimo (dia/mês longe da digitação) não é erro de ano
  const atrasado = row({ ANO: 2023, SemEpidemio: 30, DtNotificacao: "2023-07-25", createdAt: "2026-03-16 11:27:16" });
  assert.equal(audit([atrasado]).get(atrasado.key), undefined);

  // Carga em lote do banco antigo (muitos anos antigos digitados no mesmo dia) não é erro
  const carga = Array.from({ length: 60 }, (_, i) =>
    row({ ANO: 2010, SemEpidemio: (i % 50) + 1, DtNotificacao: "2010-04-10", createdAt: "2025-04-16 08:00:00", unidade: `U${i}` }));
  const resultado = audit(carga);
  assert.equal([...resultado.values()].flat().filter((x) => x.problem === "ano_errado").length, 0);
}

// ── Registro com ano errado e sem semana livre não entra na comparação do ano antigo ──
{
  const antigo = row({ ANO: 2023, SemEpidemio: 23, DtNotificacao: "2023-06-16", createdAt: "2023-06-20 10:00:00" });
  const errado = row({ ANO: 2023, SemEpidemio: 23, DtNotificacao: "2023-06-16", createdAt: "2026-06-16 12:00:00" });
  const ocupado2026 = Array.from({ length: 30 }, (_, i) => row({ ANO: 2026, SemEpidemio: i + 1, createdAt: null }));
  const f = audit([antigo, errado, ...ocupado2026]);
  assert.deepEqual(f.get(errado.key)!.map((x) => x.problem), ["ano_errado"]);
  assert.equal(f.get(errado.key)![0].suggestion, null);
  assert.equal(f.get(antigo.key), undefined, "o registro legítimo de 2023 não vira duplicata");
}

// ── Registro com ano errado não ocupa a semana do ano errado ──
{
  // Unidade com duas notificações na SE 22/2023 e a SE 23/2023 ocupada só pelo registro de 2026
  const a1 = row({ ANO: 2023, SemEpidemio: 22, createdAt: "2023-06-08 10:00:00" });
  const a2 = row({ ANO: 2023, SemEpidemio: 22, createdAt: "2023-06-12 10:00:00" });
  const errado = row({ ANO: 2023, SemEpidemio: 23, DtNotificacao: "2023-06-16", createdAt: "2026-06-16 12:00:00" });
  const f = audit([a1, a2, errado, row({ ANO: 2023, SemEpidemio: 21, createdAt: null })]);
  assert.deepEqual(f.get(a2.key)![0].suggestion, { ano: 2023, se: 23 }, "SE 23/2023 está livre de verdade");
}

// ── Semana trocada: dois registros na SE 38, digitados na SE 40 → um vai para a 39 ──
{
  const a = row({ ANO: 2026, SemEpidemio: 38, createdAt: "2026-09-25 15:09:29" });
  const b = row({ ANO: 2026, SemEpidemio: 38, createdAt: "2026-10-05 12:25:43" });
  const f = audit([...filledWeeks(37), a, b]);
  assert.equal(f.get(a.key), undefined, "o registro digitado na semana certa fica");
  assert.equal(f.get(b.key)![0].problem, "semana_trocada");
  assert.deepEqual(f.get(b.key)![0].suggestion, { ano: 2026, se: 39 });
}

// ── Semana vizinha vazia não pode ser uma semana que ainda não fechou ──
{
  const a = row({ ANO: 2026, SemEpidemio: 39, createdAt: "2026-10-05 10:41:11" });
  const b = row({ ANO: 2026, SemEpidemio: 39, createdAt: "2026-10-05 13:18:44" });
  const f = audit([...filledWeeks(38), a, b]);
  assert.notDeepEqual(f.get(b.key)?.[0].suggestion, { ano: 2026, se: 40 }, "SE 40 é a semana atual");
  assert.equal(f.get(b.key)![0].problem, "duplicata");
}

// ── Duplicata exata x duplicata com números diferentes ──
{
  const a = row({ ANO: 2026, SemEpidemio: 12, createdAt: "2026-03-31 12:52:42" });
  const b = row({ ANO: 2026, SemEpidemio: 12, createdAt: "2026-10-05 13:42:13" });
  const c = row({ ANO: 2026, SemEpidemio: 12, createdAt: "2026-10-05 13:50:00", conteudo: "2|0|0|1|1|0|1|1|0" });
  const f = audit([...filledWeeks(20, [12]), a, b, c]);
  assert.equal(f.get(a.key), undefined, "o primeiro registro da semana fica");
  assert.equal(f.get(b.key)![0].problem, "duplicata");
  assert.match(f.get(b.key)![0].issue, /reenvio 188 dia\(s\) depois/);
  assert.equal(f.get(c.key)![0].problem, "duplicata_conflito");
  assert.equal(f.get(c.key)![0].suggestion, null, "duplicata nunca é excluída automaticamente");
}

// ── Notificação negativa (zero casos) em semanas diferentes não é duplicata ──
{
  const rows = filledWeeks(30);
  assert.equal(audit(rows).size, 0);
}

// ── Integração com o cache: Excluido 'S', ID do MySQL e sugestão de ANO + SE ──
{
  assert.equal(excluidoFlag("S"), 1);
  assert.equal(excluidoFlag("N"), 0);
  assert.equal(excluidoFlag(null), 0);
  assert.equal(rowKey({ ID: 178553 }), "id:178553");
  const cleaned = cleanRow({ ID: 1, Excluido: "S", editable: "N", created_at: "2026-03-16 11:27:16", DtNotificacao: "2026-03-16" });
  assert.equal(cleaned.Excluido, 1);
  assert.equal(cleaned.created_at_origem, "2026-03-16 11:27:16");

  // CSV salvo pelo Excel: datas DD/MM/AAAA não podem virar "Data inválida"
  const excel = cleanRow({ ID: "2", Excluido: "N", DtNotificacao: "16/03/2026", created_at: "16/03/2026 11:27" });
  assert.equal(excel.DtNotificacao, "2026-03-16");
  assert.equal(excel.dt_notificacao_raw, null);
  assert.equal(excel.created_at_origem, "2026-03-16 11:27:00");
  // Reimportar uma linha já limpa preserva a data inválida original
  const reimport = cleanRow({ ID: "3", DtNotificacao: null, dt_notificacao_raw: "4202-00-13" });
  assert.equal(reimport.dt_notificacao_raw, "4202-00-13");

  const base = {
    MunicipioNotificacao: "TEJUPA", IbgeNotificacao: "355390", GVE_NOME: "AVARE", Unid_notificacao: "UBS",
    TotalCaso: 0, SexMasc: 0, SexFem: 0, FxMenorUmAno: 0, FxUmQuatro: 0, FxCincoNove: 0, FxDezQuatorze: 0, FxQuizeOuMais: 0
  };
  const records = auditCevespRows([
    { ...base, ID: "178553", ANO: 2023, SemEpidemio: 10, DtNotificacao: "2023-03-16", created_at_origem: "2026-03-16T11:27:16", Excluido: 0 },
    { ...base, ID: "999", ANO: 2026, SemEpidemio: 5, DtNotificacao: "2026-02-03", Excluido: 1 },
    { ...base, id: 3018, row_key: "abc", ANO: 2026, SemEpidemio: 0, DtNotificacao: "2026-03-10", Excluido: 0 }
  ], NOW);
  const anoErrado = records.find((r) => r.recordId === "178553")!;
  assert.equal(anoErrado.problem, "ano_errado");
  assert.deepEqual(anoErrado.suggestions, [{ field: "ANO", oldValue: "2023", newValue: "2026" }]);
  assert.ok(!records.some((r) => r.recordId === "999"), "registro excluído não é auditado");
  const semId = records.filter((r) => r.recordId === "sem-id:3018");
  assert.ok(semId.some((r) => r.problem === "sem_id"), "linha antiga do cache é sinalizada");
  assert.ok(semId.every((r) => r.suggestions.length === 0), "sem ID do MySQL nunca gera correção");
}

console.log("cevesp audit tests passed ✓");
