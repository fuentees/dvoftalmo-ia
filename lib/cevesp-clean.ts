import { createHash } from "crypto";

/**
 * Chave do cache. Usa o ID do MySQL: assim uma correção de ANO/SemEpidemio atualiza a
 * mesma linha e registros diferentes nunca são fundidos. O hash antigo só é usado para
 * linhas sem ID (importações legadas).
 */
export function rowKey(row: Record<string, unknown>): string {
  if (row.ID != null && String(row.ID).trim() !== "") return `id:${String(row.ID).trim()}`;
  return legacyRowKey(row);
}

export function legacyRowKey(row: Record<string, unknown>): string {
  const seed = [
    row.DtNotificacao ?? "", row.Unid_notificacao ?? "", row.GVE_NOME ?? "",
    row.SemEpidemio ?? "", row.MunicipioNotificacao ?? "", row.ANO ?? "",
  ].join("|");
  return createHash("md5").update(seed).digest("hex");
}

/**
 * No MySQL CEVESP `Excluido` é 'S'/'N' (varchar). No cache é 0/1.
 * Number('S') e Number('N') dão NaN, por isso a conversão precisa ser explícita.
 */
export function excluidoFlag(value: unknown): 0 | 1 {
  if (value == null) return 0;
  const v = String(value).trim().toUpperCase();
  return v === "S" || v === "1" || v === "TRUE" ? 1 : 0;
}

/**
 * Condição SQL (MySQL) dos registros de um ano: pelo ANO informado e, entre os digitados
 * no ano (created_at), os que têm ANO suspeito — vazio, no futuro, ou antigo com dia/mês
 * logo antes da digitação (erro de digitação do ano). Carga em lote de anos antigos não
 * entra. Parâmetros: cevespYearParams(ano).
 */
export const CEVESP_YEAR_WHERE = `ANO = ?
   OR (ANO IS NULL AND created_at IS NULL)
   OR (created_at >= ? AND created_at < ? AND (
        ANO IS NULL OR ANO > ?
        OR (ANO < ? AND DATEDIFF(DATE(created_at),
              STR_TO_DATE(CONCAT(YEAR(created_at), SUBSTRING(DtNotificacao, 5, 6)), '%Y-%m-%d')) BETWEEN 0 AND 14)
      ))`;

export function cevespYearParams(ano: number) {
  return [ano, `${ano}-01-01`, `${ano + 1}-01-01`, ano, ano - 1];
}

/** Aceita AAAA-MM-DD e DD/MM/AAAA (CSV salvo pelo Excel), com hora opcional. */
function normalizeDateText(v: string): string {
  const s = v.trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!br) return s.replace("T", " ");
  const pad = (n: string | undefined) => String(n ?? "0").padStart(2, "0");
  const date = `${br[3]}-${pad(br[2])}-${pad(br[1])}`;
  return br[4] ? `${date} ${pad(br[4])}:${br[5]}:${pad(br[6])}` : date;
}

/** created_at do MySQL como texto local "YYYY-MM-DD HH:MM:SS" (data de digitação). */
function toTimestamp(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  const s = normalizeDateText(String(v)).slice(0, 19);
  return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s) ? s : null;
}

function toDate(v: unknown): string | null {
  if (!v) return null;
  let s: string;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    s = v.toISOString().slice(0, 10);
  } else {
    s = normalizeDateText(String(v)).slice(0, 10);
  }
  if (!s.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return s;
}

export function cleanRow(input: Record<string, unknown>): Record<string, unknown> {
  // Linha já limpa (reimportação de JSON): a data inválida fica em dt_notificacao_raw
  const row = input.DtNotificacao == null && input.dt_notificacao_raw != null
    ? { ...input, DtNotificacao: input.dt_notificacao_raw }
    : input;
  const rawDate = row.DtNotificacao instanceof Date
    ? (isNaN(row.DtNotificacao.getTime()) ? null : row.DtNotificacao.toISOString().slice(0, 10))
    : (row.DtNotificacao != null ? normalizeDateText(String(row.DtNotificacao)).slice(0, 10) : null);
  const validDate = toDate(row.DtNotificacao);
  const invalidDate = rawDate !== null && validDate === null ? rawDate : null;

  return {
    row_key:              rowKey(row),
    ID:                   row.ID              != null ? String(row.ID)              : null,
    ControlaSubmit:       row.ControlaSubmit  != null ? String(row.ControlaSubmit)  : null,
    created_at_origem:    toTimestamp(row.created_at_origem ?? row.created_at),
    ANO:                  row.ANO             != null ? Number(row.ANO)             : null,
    Mes:                  row.Mes             != null ? Number(row.Mes)             : null,
    SemEpidemio:          row.SemEpidemio     != null ? Number(row.SemEpidemio)     : null,
    DtNotificacao:        validDate,
    dt_notificacao_raw:   invalidDate,
    MunicipioNotificacao: row.MunicipioNotificacao  != null ? String(row.MunicipioNotificacao)  : null,
    IbgeNotificacao:      row.IbgeNotificacao       != null ? String(row.IbgeNotificacao)       : null,
    GVE_NOME:             row.GVE_NOME              != null ? String(row.GVE_NOME)              : null,
    gve_numero:           row.gve_numero            != null ? Number(row.gve_numero)            : null,
    CodMacroGVE:          row.CodMacroGVE           != null ? String(row.CodMacroGVE)           : null,
    DRS_NOME:             row.DRS_NOME              != null ? String(row.DRS_NOME)              : null,
    drs_numero:           row.drs_numero            != null ? Number(row.drs_numero)            : null,
    SUBGRUPOS_VE:         row.SUBGRUPOS_VE          != null ? String(row.SUBGRUPOS_VE)          : null,
    Unid_notificacao:     row.Unid_notificacao      != null ? String(row.Unid_notificacao)      : null,
    nCNES:                row.nCNES                 != null ? String(row.nCNES)                 : null,
    UVIS:                 row.UVIS                  != null ? String(row.UVIS)                  : null,
    Nome_notificante:     row.Nome_notificante      != null ? String(row.Nome_notificante)      : null,
    CargoFuncao:          row.CargoFuncao           != null ? String(row.CargoFuncao)           : null,
    TotalCaso:            row.TotalCaso             != null ? Number(row.TotalCaso)             : null,
    SexMasc:              row.SexMasc               != null ? Number(row.SexMasc)               : null,
    SexFem:               row.SexFem                != null ? Number(row.SexFem)                : null,
    FxMenorUmAno:         row.FxMenorUmAno          != null ? Number(row.FxMenorUmAno)          : null,
    FxUmQuatro:           row.FxUmQuatro            != null ? Number(row.FxUmQuatro)            : null,
    FxCincoNove:          row.FxCincoNove           != null ? Number(row.FxCincoNove)           : null,
    FxDezQuatorze:        row.FxDezQuatorze         != null ? Number(row.FxDezQuatorze)         : null,
    FxQuizeOuMais:        row.FxQuizeOuMais         != null ? Number(row.FxQuizeOuMais)         : null,
    Surto:                row.Surto                 != null ? String(row.Surto)                 : null,
    NuSurto:              row.NuSurto               != null ? Number(row.NuSurto)               : null,
    NuColetaMaterialBio:  row.NuColetaMaterialBio   != null ? Number(row.NuColetaMaterialBio)   : null,
    ColetaMaterialBio:    row.ColetaMaterialBio     != null ? String(row.ColetaMaterialBio)     : null,
    NuAcaoEducativa:      row.NuAcaoEducativa       != null ? Number(row.NuAcaoEducativa)       : null,
    NuTreinamento:        row.NuTreinamento         != null ? Number(row.NuTreinamento)         : null,
    AfastamentoProfSintomatico: row.AfastamentoProfSintomatico != null ? String(row.AfastamentoProfSintomatico) : null,
    NuEncamimento:        row.NuEncamimento         != null ? Number(row.NuEncamimento)         : null,
    MedidaAdotada:        row.MedidaAdotada         != null ? String(row.MedidaAdotada)         : null,
    Excluido:             excluidoFlag(row.Excluido),
    editable:             excluidoFlag(row.editable),
  };
}

export function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  // Detect separator: semicolon (Brazilian Excel) or comma
  const header = lines[0];
  const sep = header.includes(";") ? ";" : ",";

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === sep && !inQuote) {
        result.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  }

  const headers = splitLine(header);
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitLine(line);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j].trim().replace(/^"|"$/g, "");
      const val = (values[j] ?? "").trim().replace(/^"|"$/g, "");
      row[key] = val === "" ? null : val;
    }
    rows.push(row);
  }

  return rows;
}
