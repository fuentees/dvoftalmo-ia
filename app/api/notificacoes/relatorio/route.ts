import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { readNotificationRows } from "@/lib/external/notification-db";
import { summarizeNotificationRows } from "@/services/notification-report";

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ano = searchParams.get("ano") ? Number(searchParams.get("ano")) : undefined;

  try {
    const data = await readNotificationRows(ano);
    return NextResponse.json(summarizeNotificationRows(data.rows, data.total));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Erro ao conectar ao banco de notificacoes.",
        hint: "Confirme se o servidor MariaDB esta acessivel pela maquina que roda o Next.js e se o usuario possui permissao somente leitura."
      },
      { status: 500 }
    );
  }
}
