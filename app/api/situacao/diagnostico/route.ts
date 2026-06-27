import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getCacheSyncInfo } from "@/lib/external/supabase-cevesp";
import { getSinanTracomaStatus } from "@/services/sinan-tracoma";

type DiagnosticStatus = "ok" | "warning" | "error";

async function safeCheck(label: string, run: () => Promise<{ status: DiagnosticStatus; message: string; detail?: string }>) {
  try {
    return { label, ...(await run()) };
  } catch (error) {
    return {
      label,
      status: "warning" as DiagnosticStatus,
      message: "Indisponivel neste ambiente",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function countRows(table: string) {
  const supabase = createAdminClient();
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function GET() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authDisabled = process.env.DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production";

  const checks = await Promise.all([
    safeCheck("Autenticacao", async () => ({
      status: authDisabled ? "warning" : "ok",
      message: authDisabled ? "Modo local sem login" : "Sessao validada"
    })),
    safeCheck("CEVESP", async () => {
      const status = await getCacheSyncInfo();
      const totalRows = Number(status.totalRows ?? 0);
      return {
        status: totalRows > 0 ? "ok" : "warning",
        message: totalRows > 0 ? `${totalRows.toLocaleString("pt-BR")} registros no cache` : "Cache sem registros",
        detail: status.lastSync ? `Ultima sincronizacao: ${new Date(status.lastSync).toLocaleString("pt-BR")}` : undefined
      };
    }),
    safeCheck("SINAN Tracoma", async () => {
      const status = await getSinanTracomaStatus();
      return {
        status: status.hasData ? "ok" : "warning",
        message: status.hasData ? `${status.totalRows.toLocaleString("pt-BR")} registros importados` : "Banco ainda sem dados",
        detail: status.years.length ? `Periodo: ${status.minYear}-${status.maxYear}` : undefined
      };
    }),
    safeCheck("Populacao IBGE", async () => {
      const totalRows = await countRows("ibge_municipio_populacao");
      return {
        status: totalRows > 0 ? "ok" : "warning",
        message: totalRows > 0 ? `${totalRows.toLocaleString("pt-BR")} linhas disponiveis` : "Tabela sem populacao"
      };
    }),
    safeCheck("Boletins", async () => {
      const totalRows = await countRows("bulletins");
      return {
        status: "ok",
        message: `${totalRows.toLocaleString("pt-BR")} boletins cadastrados`
      };
    })
  ]);

  const hasError = checks.some((check) => check.status === "error");
  const hasWarning = checks.some((check) => check.status === "warning");

  return NextResponse.json({
    status: hasError ? "error" : hasWarning ? "warning" : "ok",
    generatedAt: new Date().toISOString(),
    checks
  });
}
