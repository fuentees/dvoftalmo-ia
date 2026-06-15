import { existsSync, readdirSync } from "fs";
import { resolve } from "path";
import { NextResponse } from "next/server";

interface FolderInfo {
  dirExists: boolean;
  files: string[];
}

interface GeoDebugInfo {
  baseDir: string;
  dirExists: boolean;
  contents: Record<string, FolderInfo>;
}

export async function GET() {
  const shapesDir = resolve(process.cwd(), "shapes");

  try {
    const info: GeoDebugInfo = {
      baseDir: shapesDir,
      dirExists: existsSync(shapesDir),
      contents: {}
    };

    if (info.dirExists) {
      for (const folder of ["municipio", "gve"]) {
        const folderPath = resolve(shapesDir, folder);
        info.contents[folder] = {
          dirExists: existsSync(folderPath),
          files: existsSync(folderPath) ? readdirSync(folderPath) : []
        };
      }
    }

    return NextResponse.json(info);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
