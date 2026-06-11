import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import { tmpdir } from "os";
import { DBFFile } from "dbffile";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireCevespSyncPermission } from "@/lib/admin-guard";
import { importSinanTracomaRows, type SinanTracomaBank } from "@/services/sinan-tracoma";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireCevespSyncPermission(supabase, user.id);
  if (denied) return denied;

  const form = await request.formData();
  const bank = form.get("bank");
  const file = form.get("file");

  if (bank !== "traconet" && bank !== "nottraconet") {
    return NextResponse.json({ error: "Informe bank como traconet ou nottraconet." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo DBF obrigatorio." }, { status: 400 });
  }

  const tmpPath = join(tmpdir(), `sinan-${randomUUID()}.dbf`);
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(tmpPath, bytes);
    const dbf = await DBFFile.open(tmpPath, { encoding: "latin1" });
    const importId = `${bank}-${Date.now()}`;
    const batchSize = 500;
    let imported = 0;

    for (;;) {
      const records = await dbf.readRecords(batchSize);
      if (records.length === 0) break;
      imported += records.length;
      await importSinanTracomaRows({
        rows: records as Array<Record<string, unknown>>,
        bank: bank as SinanTracomaBank,
        importId,
        totalRows: dbf.recordCount,
        isLastBatch: imported >= dbf.recordCount
      });
    }

    return NextResponse.json({ imported, totalRows: dbf.recordCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao importar DBF do SINAN." },
      { status: 500 }
    );
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}
