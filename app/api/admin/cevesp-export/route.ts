import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireCevespSyncPermission } from "@/lib/admin-guard";
import {
  createNotificationConnection,
  getNotificationTableName,
} from "@/lib/external/notification-db";

function rowKey(row: Record<string, unknown>): string {
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

function clean(row: Record<string, unknown>): Record<string, unknown> {
  const rawDate   = row.DtNotificacao instanceof Date
    ? (isNaN(row.DtNotificacao.getTime()) ? null : row.DtNotificacao.toISOString().slice(0, 10))
    : (row.DtNotificacao != null ? String(row.DtNotificacao).slice(0, 10) : null);
  const validDate = toDate(row.DtNotificacao);
  const invalidDate = rawDate !== null && validDate === null ? rawDate : null;

  return {
    row_key:              rowKey(row),
    ANO:                  row.ANO         != null ? Number(row.ANO)         : null,
    Mes:                  row.Mes         != null ? Number(row.Mes)         : null,
    SemEpidemio:          row.SemEpidemio != null ? Number(row.SemEpidemio) : null,
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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireCevespSyncPermission(supabase, user.id);
  if (denied) return denied;

  if (!process.env.NOTIFY_DB_HOST) {
    return NextResponse.json(
      { error: "MySQL não acessível. Execute esta ação no escritório (rede SES-SP) com o servidor local." },
      { status: 503 }
    );
  }

  let table: string;
  try {
    const t = getNotificationTableName();
    if (!/^[a-zA-Z0-9_]+$/.test(t)) throw new Error("inválido");
    table = t;
  } catch {
    return NextResponse.json({ error: "NOTIFY_DB_TABLE inválido ou não configurado." }, { status: 500 });
  }

  const full      = request.nextUrl.searchParams.get("full") === "true";
  const yearParam = request.nextUrl.searchParams.get("year");
  const currentYear = new Date().getFullYear();

  let conn: Awaited<ReturnType<typeof createNotificationConnection>> | null = null;
  try {
    conn = await createNotificationConnection();

    let years: number[];
    if (full) {
      const [[r]] = await conn.query(
        `SELECT MIN(ANO) AS mn, MAX(ANO) AS mx FROM \`${table}\``
      ) as [Array<{ mn: number; mx: number }>, unknown];
      const min = r?.mn ?? currentYear;
      const max = r?.mx ?? currentYear;
      years = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    } else if (yearParam) {
      years = [parseInt(yearParam, 10)];
    } else {
      years = [currentYear];
    }

    const allRows: Record<string, unknown>[] = [];
    for (const ano of years) {
      const [rows] = await conn.query(
        `SELECT * FROM \`${table}\` WHERE ANO = ?`,
        [ano]
      ) as [Array<Record<string, unknown>>, unknown];
      allRows.push(...rows.map(clean));
    }

    const json = JSON.stringify(allRows);
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="cevesp-export.json"`,
        "X-Row-Count": String(allRows.length),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetwork = msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("ENOTFOUND");
    if (isNetwork) {
      return NextResponse.json(
        { error: "Não foi possível conectar ao MySQL. Verifique que está na rede do escritório." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    await conn?.end();
  }
}
