import assert from "node:assert/strict";
import { readNotificationRowsFromCache } from "@/lib/external/notification-db";
import { buildBulletinDistribution, buildCevespSummary, fetchCevespWeek, generateConjuntiviteBulletin } from "@/services/bulletins-conjuntivite-generator";
import { summaryToMarkdown } from "@/lib/bulletin-format";

type Row = Record<string, unknown>;
type Response = { data: Row[] | null; count: number | null; error: { message: string } | null };

/** A read-only fixture that applies the actual query filters and pagination. */
function cacheFixture(rows: Row[], options: { failPage?: number; incompletePage?: number; failCount?: boolean } = {}) {
  const pageRanges: Array<[number, number]> = [];
  let pageNumber = 0;
  const client = {
    from(table: string) {
      assert.equal(table, "cevesp_notificacoes");
      const predicates: Array<(row: Row) => boolean> = [];
      let head = false;
      let range: [number, number] | undefined;
      const columnKey = (column: string) => column.replace(/"/g, "");
      const query = {
        select(_columns: string, settings?: { head?: boolean }) { head = settings?.head === true; return query; },
        or(expression: string) {
          assert.equal(expression, "Excluido.is.null,Excluido.eq.0");
          predicates.push(row => row.Excluido == null || row.Excluido === 0);
          return query;
        },
        eq(column: string, value: unknown) { predicates.push(row => row[columnKey(column)] === value); return query; },
        gte(column: string, value: number) { predicates.push(row => Number(row[columnKey(column)]) >= value); return query; },
        lte(column: string, value: number) { predicates.push(row => Number(row[columnKey(column)]) <= value); return query; },
        order(column: string) { assert.equal(column, "id"); return query; },
        range(from: number, to: number) { range = [from, to]; pageRanges.push(range); return query; },
        then(onFulfilled: (response: Response) => unknown, onRejected?: (reason: unknown) => unknown) {
          const matching = rows.filter(row => predicates.every(predicate => predicate(row))).sort((a, b) => Number(a.id) - Number(b.id));
          let result: Response;
          if (head) result = { data: null, count: options.failCount ? null : matching.length, error: options.failCount ? { message: "count unavailable" } : null };
          else {
            pageNumber += 1;
            assert.ok(range, "Every data request must have an explicit page range");
            const data = matching.slice(range[0], range[1] + 1);
            if (options.incompletePage === pageNumber) data.pop();
            result = { data, count: null, error: options.failPage === pageNumber ? { message: "page unavailable" } : null };
          }
          return Promise.resolve(result).then(onFulfilled, onRejected);
        }
      };
      return query;
    }
  } as unknown as Parameters<typeof fetchCevespWeek>[0];
  return { client, pageRanges };
}

async function verify() {
  const rows: Row[] = Array.from({ length: 1505 }, (_, id) => ({ id, ANO: 2025, SemEpidemio: 10, Excluido: id % 20 === 0 ? 1 : id % 11 === 0 ? null : 0, TotalCaso: 1 }));
  rows.push({ id: 1506, ANO: 2025, SemEpidemio: 11, Excluido: 0, TotalCaso: 100 });
  rows.push({ id: 1507, ANO: 2024, SemEpidemio: 10, Excluido: 0, TotalCaso: 100 });
  const fixture = cacheFixture(rows);
  const loaded = await fetchCevespWeek(fixture.client, 10, 2025);
  const expected = rows.filter(row => row.ANO === 2025 && row.SemEpidemio === 10 && row.Excluido !== 1);
  assert.ok(expected.length > 1000);
  assert.deepEqual(loaded, expected, "The bulletin must include all matching active rows, including the second page");
  assert.deepEqual(fixture.pageRanges, [[0, 999], [1000, expected.length - 1]]);
  await assert.rejects(fetchCevespWeek(cacheFixture(rows, { failPage: 2 }).client, 10, 2025), /page unavailable/, "Failure after page one must not yield a partial bulletin");
  await assert.rejects(fetchCevespWeek(cacheFixture(rows, { incompletePage: 2 }).client, 10, 2025), /Leitura incompleta/, "A silently shortened page must not become a complete report");
  await assert.rejects(fetchCevespWeek(cacheFixture(rows, { failCount: true }).client, 10, 2025), /count unavailable/);
  assert.deepEqual(await fetchCevespWeek(cacheFixture([]).client, 10, 2025), []);
  const limitedFixture = cacheFixture(rows);
  const limited = await readNotificationRowsFromCache({ ano: 2025, seInicio: 10, seFim: 10, limit: 1200 }, limitedFixture.client);
  assert.equal(limited.rows.length, 1200);
  assert.equal(limited.total, expected.length);
  assert.deepEqual(limitedFixture.pageRanges, [[0, 999], [1000, 1199]]);

  const fields = [{ key: "SexMasc", label: "Masculino" }, { key: "SexFem", label: "Feminino" }];
  const invalidProfile = buildBulletinDistribution([{ TotalCaso: 10, SexMasc: 800, SexFem: 2 }], "sexo", fields);
  assert.match(invalidProfile, /indisponível/);
  assert.doesNotMatch(invalidProfile, /800|Masculino:|%/, "Impossible counts must not appear as an interpretable profile in the bulletin");
  const cancellation = buildBulletinDistribution([{ TotalCaso: 10, SexMasc: 15, SexFem: 0 }, { TotalCaso: 10, SexMasc: 5, SexFem: 0 }], "sexo", fields);
  assert.match(cancellation, /indisponível/, "Errors in individual rows cannot cancel into a valid aggregate");
  const partial = buildBulletinDistribution([{ TotalCaso: 10, SexMasc: 3, SexFem: null }], "sexo", fields);
  assert.match(partial, /parcial: 3 de 10/);
  assert.doesNotMatch(partial, /%/);
  assert.match(buildBulletinDistribution([{ TotalCaso: 10, SexMasc: 3, SexFem: 7 }], "sexo", fields), /Masculino: 3 \(30,0%\)/);
  assert.match(buildBulletinDistribution([{ TotalCaso: 10, SexMasc: null, SexFem: null }], "sexo", fields), /indisponível/);
  assert.match(buildBulletinDistribution([{ TotalCaso: 0, SexMasc: 0, SexFem: 0 }], "sexo", fields), /não se aplica/);

  const summary = buildCevespSummary(1, 2027, [
    { TotalCaso: 10, SexMasc: 800, SexFem: 2, Excluido: 0 },
    { TotalCaso: 999, SexMasc: 999, SexFem: 0, Excluido: 1 },
  ], [], []);
  assert.match(summary, /Total de casos notificados: 10/);
  assert.doesNotMatch(summary, /999|800/);
  assert.match(summary, /SE anterior \(SE 52\/2026\)/, "The comparison label must honor the epidemiological calendar");
  assert.match(summary, /comparação indisponível/);
  assert.match(summary, /Coletas de material biológico: Indisponível/, "Missing action counts must not be presented as observed zero");
  const markdown = summaryToMarkdown(summary);
  assert.match(markdown, /## SEXO/);
  assert.match(markdown, /Total de casos notificados: 10/);
  assert.match(markdown, /Distribuição por sexo indisponível/);
  assert.doesNotMatch(markdown, /800|999|Masculino:/, "The deterministic Markdown bulletin must preserve the safeguards from the summary");
  assert.match(buildCevespSummary(10, 2025, [{ TotalCaso: 0, SexMasc: 0, SexFem: 0 }], [{ TotalCaso: 0 }], []), /período anterior com zero casos; variação percentual não definida/);
  const rejected = await generateConjuntiviteBulletin({ ano: 9999, se: 1 });
  assert.equal(rejected.ok, false, "An impossible period must be rejected before accessing a database or AI");
  console.log("Conjuntivite bulletin pagination, transport errors, exclusions and profile safeguards passed");
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
