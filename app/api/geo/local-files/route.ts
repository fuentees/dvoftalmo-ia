import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { NextResponse } from "next/server";

const SHAPES_DIR = resolve(process.cwd(), "shapes");

interface LocalShapeFileInfo {
  exists: boolean;
  size?: number;
}

interface LocalFilesResponse {
  baseDir: string;
  municipio: {
    shp: LocalShapeFileInfo;
    dbf: LocalShapeFileInfo;
  };
}

function checkFile(path: string): LocalShapeFileInfo {
  if (!existsSync(path)) return { exists: false };
  return { exists: true, size: statSync(path).size };
}

export async function GET() {
  try {
    const municipioDir = resolve(SHAPES_DIR, "municipio");
    const response: LocalFilesResponse = {
      baseDir: SHAPES_DIR,
      municipio: {
        shp: checkFile(resolve(municipioDir, "municipios_sp.shp")),
        dbf: checkFile(resolve(municipioDir, "municipios_sp.dbf"))
      }
    };

    return NextResponse.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
