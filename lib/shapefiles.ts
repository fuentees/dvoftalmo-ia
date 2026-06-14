import { readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import * as shapefile from "shapefile";
import type { FeatureCollection } from "geojson";

const SHAPES_DIR = resolve(process.cwd(), "shapes");

export async function loadShapefileAsGeoJSON(
  subfolder: "gve" | "municipio",
  filename: string
): Promise<FeatureCollection> {
  try {
    const shpPath = resolve(SHAPES_DIR, subfolder, filename);
    const dbfPath = resolve(SHAPES_DIR, subfolder, filename.replace(".shp", ".dbf"));

    console.log(`[shapefiles] Loading ${subfolder}/${filename}`);
    console.log(`[shapefiles] SHP path: ${shpPath}`);
    console.log(`[shapefiles] DBF path: ${dbfPath}`);

    // Convert to file:// URLs — shapefile.open may require a proper URL in some runtimes (e.g. serverless)
    const shpUrl = pathToFileURL(shpPath).href;
    const dbfUrl = pathToFileURL(dbfPath).href;
    console.log(`[shapefiles] Attempting open using file URLs: ${shpUrl}, ${dbfUrl}`);

    const attemptErrors: any[] = [];
    let source: any = null;
    try {
      source = await shapefile.open(shpUrl, dbfUrl);
    } catch (firstErr) {
      console.warn(`[shapefiles] Failed opening with file URLs: ${String(firstErr)}. Trying local paths...`);
      attemptErrors.push({ step: "fileUrl", message: String(firstErr), stack: firstErr && (firstErr as Error).stack });
      try {
        source = await shapefile.open(shpPath, dbfPath);
      } catch (secondErr) {
        console.warn(`[shapefiles] Failed opening with local paths: ${String(secondErr)}. Trying shapefile.read fallback...`);
        attemptErrors.push({ step: "localPath", message: String(secondErr), stack: secondErr && (secondErr as Error).stack });
        try {
          // shapefile.read returns a FeatureCollection directly
          const fc = await (shapefile as any).read(shpPath);
          if (fc && fc.type === "FeatureCollection") {
            console.log(`[shapefiles] Loaded via shapefile.read fallback with ${fc.features?.length || 0} features.`);
            return fc as FeatureCollection;
          }
        } catch (readErr) {
          console.error(`[shapefiles] shapefile.read fallback failed: ${String(readErr)}`);
          attemptErrors.push({ step: "shapefile.read", message: String(readErr), stack: readErr && (readErr as Error).stack });
          // continue to next fallback
        }
        // As a last resort, read the .shp and .dbf files into memory and try opening from ArrayBuffers
        try {
          console.log(`[shapefiles] Attempting fallback: read files into memory and open from ArrayBuffers`);
          const shpBuf = readFileSync(shpPath);
          const dbfBuf = readFileSync(dbfPath);
          const shpArray = shpBuf.buffer.slice(shpBuf.byteOffset, shpBuf.byteOffset + shpBuf.byteLength);
          const dbfArray = dbfBuf.buffer.slice(dbfBuf.byteOffset, dbfBuf.byteOffset + dbfBuf.byteLength);
          source = await shapefile.open(shpArray as any, dbfArray as any);
        } catch (memErr) {
          console.error(`[shapefiles] In-memory ArrayBuffer fallback failed: ${String(memErr)}`);
          attemptErrors.push({ step: "inMemory", message: String(memErr), stack: memErr && (memErr as Error).stack });
          // if all fallbacks failed, throw consolidated error
          throw new Error(JSON.stringify({ message: "All shapefile open attempts failed", attempts: attemptErrors }));
        }
        // If we reach here without a source or fc, throw consolidated error
        throw new Error(JSON.stringify({ message: "Local path and read fallbacks failed", attempts: attemptErrors }));
      }
    }
    const features: any[] = [];

    let result = await source.read();
    while (!result.done) {
      if (result.value.geometry) {
        features.push(result.value);
      }
      result = await source.read();
    }

    console.log(`[shapefiles] Loaded ${features.length} features from ${subfolder}/${filename}`);

    return {
      type: "FeatureCollection",
      features
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[shapefiles] Error loading ${subfolder}/${filename}:`, msg);
    throw new Error(`Failed to load shapefile ${subfolder}/${filename}: ${msg}`);
  }
}

export async function loadGVEShapefile(): Promise<FeatureCollection> {
  return loadShapefileAsGeoJSON("gve", "GVE.shp");
}

export async function loadMunicipisShapefile(): Promise<FeatureCollection> {
  return loadShapefileAsGeoJSON("municipio", "municipios_sp.shp");
}
