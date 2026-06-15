import { readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import * as shapefile from "shapefile";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const SHAPES_DIR = resolve(process.cwd(), "shapes");

type ShapefileFeature = Feature<Geometry, Record<string, unknown>>;

interface LoadAttemptError {
  step: string;
  message: string;
  stack?: string;
}

function errorInfo(error: unknown, step: string): LoadAttemptError {
  return {
    step,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  };
}

export async function loadShapefileAsGeoJSON(
  subfolder: "gve" | "municipio",
  filename: string
): Promise<FeatureCollection> {
  try {
    const shpPath = resolve(SHAPES_DIR, subfolder, filename);
    const dbfPath = resolve(SHAPES_DIR, subfolder, filename.replace(".shp", ".dbf"));
    const shpUrl = pathToFileURL(shpPath).href;
    const dbfUrl = pathToFileURL(dbfPath).href;

    const attemptErrors: LoadAttemptError[] = [];
    let source: shapefile.ShapefileSource | null = null;

    try {
      source = await shapefile.open(shpUrl, dbfUrl);
    } catch (firstErr) {
      attemptErrors.push(errorInfo(firstErr, "fileUrl"));
      try {
        source = await shapefile.open(shpPath, dbfPath);
      } catch (secondErr) {
        attemptErrors.push(errorInfo(secondErr, "localPath"));
        try {
          const fc = await shapefile.read(shpPath);
          if (fc?.type === "FeatureCollection") return fc;
        } catch (readErr) {
          attemptErrors.push(errorInfo(readErr, "shapefile.read"));
        }

        try {
          const shpBuf = readFileSync(shpPath);
          const dbfBuf = readFileSync(dbfPath);
          const shpArray = shpBuf.buffer.slice(shpBuf.byteOffset, shpBuf.byteOffset + shpBuf.byteLength);
          const dbfArray = dbfBuf.buffer.slice(dbfBuf.byteOffset, dbfBuf.byteOffset + dbfBuf.byteLength);
          source = await shapefile.open(shpArray, dbfArray);
        } catch (memErr) {
          attemptErrors.push(errorInfo(memErr, "inMemory"));
          throw new Error(JSON.stringify({ message: "All shapefile open attempts failed", attempts: attemptErrors }));
        }
      }
    }

    if (!source) {
      throw new Error(JSON.stringify({ message: "No shapefile source available", attempts: attemptErrors }));
    }

    const features: ShapefileFeature[] = [];
    let result = await source.read();
    while (!result.done) {
      if (result.value.geometry) {
        features.push(result.value as ShapefileFeature);
      }
      result = await source.read();
    }

    return {
      type: "FeatureCollection",
      features
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load shapefile ${subfolder}/${filename}: ${msg}`);
  }
}

export async function loadGVEShapefile(): Promise<FeatureCollection> {
  return loadShapefileAsGeoJSON("gve", "GVE.shp");
}

export async function loadMunicipisShapefile(): Promise<FeatureCollection> {
  return loadShapefileAsGeoJSON("municipio", "municipios_sp.shp");
}
