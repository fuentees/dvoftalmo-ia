import { readFileSync } from "fs";
import { resolve } from "path";
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

    const source = await shapefile.open(shpPath, dbfPath);
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
