import { NextResponse } from "next/server";
import { existsSync, readdirSync } from "fs";
import { resolve } from "path";

export async function GET() {
  const SHAPES_DIR = resolve(process.cwd(), "shapes");
  
  try {
    const info: Record<string, any> = {
      baseDir: SHAPES_DIR,
      dirExists: existsSync(SHAPES_DIR),
      contents: {}
    };

    if (existsSync(SHAPES_DIR)) {
      const folders = ["municipio", "gve"];
      
      for (const folder of folders) {
        const folderPath = resolve(SHAPES_DIR, folder);
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
