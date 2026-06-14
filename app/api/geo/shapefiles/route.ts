import { NextResponse } from "next/server";
import { loadGVEShapefile, loadMunicipisShapefile } from "@/lib/shapefiles";

let gveCache: any = null;
let municipiosCache: any = null;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "gve";

  try {
    if (type === "municipios") {
      if (!municipiosCache) {
        municipiosCache = await loadMunicipisShapefile();
      }
      return NextResponse.json(municipiosCache);
    } else {
      if (!gveCache) {
        gveCache = await loadGVEShapefile();
      }
      return NextResponse.json(gveCache);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
