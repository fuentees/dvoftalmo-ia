declare module "shapefile" {
  export interface DBFHeader {
    recordCount: number;
    recordSize: number;
  }

  export interface ShapefileRecord {
    geometry: any;
    properties: Record<string, any>;
  }

  export interface ShapefileSource {
    read(): Promise<{ done: boolean; value: ShapefileRecord }>;
  }

  export function open(
    shpPath: string,
    dbfPath?: string,
    options?: any
  ): Promise<ShapefileSource>;
}
