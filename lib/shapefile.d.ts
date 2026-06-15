declare module "shapefile" {
  import type { FeatureCollection, Geometry } from "geojson";

  export interface DBFHeader {
    recordCount: number;
    recordSize: number;
  }

  export interface ShapefileRecord {
    geometry: Geometry | null;
    properties: Record<string, unknown>;
  }

  export interface ShapefileSource {
    read(): Promise<{ done: boolean; value: ShapefileRecord }>;
  }

  export function open(
    shpPath: string | ArrayBuffer,
    dbfPath?: string | ArrayBuffer,
    options?: Record<string, unknown>
  ): Promise<ShapefileSource>;

  export function read(shpPath: string): Promise<FeatureCollection>;
}
