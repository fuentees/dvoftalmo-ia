"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { FeatureCollection, Feature, Geometry } from "geojson";

export type ChoroplethMapProps = {
  dataUrl: string; // API endpoint to fetch GeoJSON
  valueMap?: Record<string, number>; // Map of feature property (usually name) to color value
  colorScheme?: (value: number | null) => string; // Function to determine color based on value
  label?: string;
  className?: string;
};

const SVG_WIDTH = 820;
const SVG_HEIGHT = 520;
const MARGIN = 16;

function getRings(geometry: Geometry): Array<number[][]> {
  if (geometry.type === "Polygon") {
    return geometry.coordinates as number[][][];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][]).flat();
  }
  return [];
}

function buildPaths(features: Feature<Geometry, any>[]) {
  const rings = features.flatMap((feature) => ({
    rings: getRings(feature.geometry),
    properties: feature.properties
  }));

  const allPoints = rings.flatMap((r) =>
    r.rings.flatMap((ring) => ring.map(([lng, lat]) => ({ lng, lat })))
  );

  if (allPoints.length === 0) return [];

  const minLng = Math.min(...allPoints.map((p) => p.lng));
  const maxLng = Math.max(...allPoints.map((p) => p.lng));
  const minLat = Math.min(...allPoints.map((p) => p.lat));
  const maxLat = Math.max(...allPoints.map((p) => p.lat));

  const scaleX = (SVG_WIDTH - 2 * MARGIN) / (maxLng - minLng);
  const scaleY = (SVG_HEIGHT - 2 * MARGIN) / (maxLat - minLat);
  const scale = Math.min(scaleX, scaleY);

  return rings.map((r) => ({
    properties: r.properties,
    paths: r.rings.map((ring) => {
      const path = ring
        .map(([lng, lat], index) => {
          const x = (lng - minLng) * scale + MARGIN;
          const y = (maxLat - lat) * scale + MARGIN;
          return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ");
      return `${path} Z`;
    })
  }));
}

export function ChoroplethMap({
  dataUrl,
  valueMap = {},
  colorScheme = (value) => {
    if (value === null || value === undefined) return "#94a3b8";
    if (value >= 50) return "#dc2626";
    if (value >= 20) return "#f59e0b";
    if (value >= 5) return "#84cc16";
    return "#14b8a6";
  },
  label = "Mapa",
  className
}: ChoroplethMapProps) {
  const [geoData, setGeoData] = useState<FeatureCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetch(dataUrl);
        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);
        const data = await response.json();
        setGeoData(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [dataUrl]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed p-8 text-muted-foreground ${className}`}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="ml-2">Carregando mapa...</span>
      </div>
    );
  }

  if (error || !geoData) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-amber-600 ${className}`}>
        <AlertTriangle className="h-5 w-5" />
        <p className="mt-2 text-sm">{error || "Não foi possível carregar o mapa"}</p>
      </div>
    );
  }

  const features = geoData.type === "FeatureCollection" ? geoData.features : [geoData as any];
  const pathData = buildPaths(features);

  // Create a map of feature names to values for lookup
  const getFeatureColor = (properties: any): string => {
    const name = properties?.NOME || properties?.name || properties?.Nome || "";
    const value = valueMap[name];
    return colorScheme(value);
  };

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-[360px] w-full" preserveAspectRatio="xMidYMid meet">
          {pathData.map((item, idx) => (
            item.paths.map((d: string, pathIdx: number) => {
              const featureName = item.properties?.NOME || item.properties?.name || `Region ${idx}`;
              return (
                <path
                  key={`${idx}-${pathIdx}`}
                  d={d}
                  fill={getFeatureColor(item.properties)}
                  fillOpacity="0.75"
                  stroke="#0f766e"
                  strokeWidth="0.8"
                  strokeLinejoin="round"
                  fillRule="evenodd"
                  className="hover:stroke-2 hover:stroke-foreground transition-all"
                  data-title={featureName}
                />
              );
            })
          ))}
        </svg>
      </div>
    </div>
  );
}
