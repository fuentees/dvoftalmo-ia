import { NextResponse } from "next/server";
import type { FeatureCollection } from "geojson";
import { loadGVEShapefile, loadMunicipisShapefile } from "@/lib/shapefiles";

let gveCache: FeatureCollection | null = null;
let municipiosCache: FeatureCollection | null = null;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "gve";

  try {
    if (type === "municipio") {
      if (!municipiosCache) municipiosCache = await loadMunicipisShapefile();
      return NextResponse.json(municipiosCache);
    }

    if (!gveCache) gveCache = await loadGVEShapefile();
    return NextResponse.json(gveCache);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg, type }, { status: 500 });
  }
}
