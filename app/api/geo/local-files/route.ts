import { NextResponse } from "next/server";
import { resolve } from "path";
import { existsSync, statSync, readFileSync } from "fs";

const SHAPES_DIR = resolve(process.cwd(), "shapes");

export async function GET(request: Request) {
  try {
    const municipioDir = resolve(SHAPES_DIR, "municipio");
    const shpPath = resolve(municipioDir, "municipios_sp.shp");
    const dbfPath = resolve(municipioDir, "municipios_sp.dbf");

    const resp: any = { baseDir: SHAPES_DIR, municipio: {} };

    const checkFile = (p: string) => {
      const exists = existsSync(p);
      const info: any = { exists };
      if (exists) {
        const st = statSync(p);
        info.size = st.size;
        const buf = readFileSync(p);
        info.sample = buf.slice(0, 64).toString("hex");
      }
      return info;
    };

    resp.municipio.shp = checkFile(shpPath);
    resp.municipio.dbf = checkFile(dbfPath);

    return NextResponse.json(resp);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
