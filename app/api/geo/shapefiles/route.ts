import { NextResponse } from "next/server";
import { loadGVEShapefile, loadMunicipisShapefile } from "@/lib/shapefiles";

let gveCache: any = null;
let municipiosCache: any = null;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "gve";

  try {
    console.log(`[geo/shapefiles] Loading shapefile type: ${type}`);
    
    if (type === "municipio") {
      if (!municipiosCache) {
        console.log("[geo/shapefiles] Fetching municipios shapefile...");
        municipiosCache = await loadMunicipisShapefile();
        console.log(`[geo/shapefiles] Loaded ${municipiosCache.features?.length || 0} municipios`);
      }
      return NextResponse.json(municipiosCache);
    } else {
      if (!gveCache) {
        console.log("[geo/shapefiles] Fetching GVE shapefile...");
        gveCache = await loadGVEShapefile();
        console.log(`[geo/shapefiles] Loaded ${gveCache.features?.length || 0} GVEs`);
      }
      return NextResponse.json(gveCache);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[geo/shapefiles] Error loading shapefile type ${type}:`, msg);
    if (error instanceof Error) {
      console.error("[geo/shapefiles] Stack:", error.stack);
    }
    const payload: any = { error: msg, type };
    if (error instanceof Error && error.stack) payload.stack = error.stack;
    return NextResponse.json(payload, { status: 500 });
  }
}
