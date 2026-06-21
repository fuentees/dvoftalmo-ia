import { createHash } from "crypto";

export function rowKey(row: Record<string, unknown>): string {
  const seed = [
    row.DtNotificacao ?? "", row.Unid_notificacao ?? "", row.GVE_NOME ?? "",
    row.SemEpidemio ?? "", row.MunicipioNotificacao ?? "", row.ANO ?? "",
  ].join("|");
  return createHash("md5").update(seed).digest("hex");
}

function toDate(v: unknown): string | null {
  if (!v) return null;
  let s: string;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    s = v.toISOString().slice(0, 10);
  } else {
    s = String(v).slice(0, 10);
  }
  if (!s.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return s;
}

export function cleanRow(row: Record<string, unknown>): Record<string, unknown> {
  const rawDate = row.DtNotificacao instanceof Date
    ? (isNaN(row.DtNotificacao.getTime()) ? null : row.DtNotificacao.toISOString().slice(0, 10))
    : (row.DtNotificacao != null ? String(row.DtNotificacao).slice(0, 10) : null);
  const validDate = toDate(row.DtNotificacao);
  const invalidDate = rawDate !== null && validDate === null ? rawDate : null;

  return {
    row_key:              rowKey(row),
    ID:                   row.ID              != null ? String(row.ID)              : null,
    ControlaSubmit:       row.ControlaSubmit  != null ? String(row.ControlaSubmit)  : null,
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
    Excluido:             row.Excluido              != null ? Number(row.Excluido)              : 0,
    editable:             row.editable              != null ? Number(row.editable)              : 0,
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
