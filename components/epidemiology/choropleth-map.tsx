"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Feature, FeatureCollection, Geometry } from "geojson";

type GeoProperties = Record<string, unknown>;

export type ChoroplethMapProps = {
  dataUrl: string;
  valueMap?: Record<string, number>;
  colorScheme?: (value: number | null) => string;
  label?: string;
  className?: string;
};

const SVG_WIDTH = 820;
const SVG_HEIGHT = 520;
const MARGIN = 16;

function getRings(geometry: Geometry): Array<number[][]> {
  if (geometry.type === "Polygon") return geometry.coordinates as number[][][];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as number[][][][]).flat();
  return [];
}

function buildPaths(features: Array<Feature<Geometry, GeoProperties>>) {
  const rings = features.flatMap(feature => ({
    rings: getRings(feature.geometry),
    properties: feature.properties
  }));

  let pointCount = 0;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const item of rings) {
    for (const ring of item.rings) {
      for (const [lng, lat] of ring) {
        pointCount += 1;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  if (pointCount === 0) return [];

  const scaleX = (SVG_WIDTH - 2 * MARGIN) / (maxLng - minLng);
  const scaleY = (SVG_HEIGHT - 2 * MARGIN) / (maxLat - minLat);
  const scale = Math.min(scaleX, scaleY);

  return rings.map(item => ({
    properties: item.properties,
    paths: item.rings.map(ring => {
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

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeValueMap(valueMap: Record<string, number>) {
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(valueMap)) {
    normalized[key] = value;
    normalized[normalizeKey(key)] = value;
    const digits = key.replace(/\D/g, "");
    if (digits) {
      normalized[digits] = value;
      normalized[digits.slice(0, 6)] = value;
    }
  }
  return normalized;
}

function featureCandidates(properties: GeoProperties) {
  const values = [
    properties.CD_MUN,
    properties.CODMUN6,
    properties.NM_MUN,
    properties.GVE,
    properties.DRS,
    properties.NOME,
    properties.Nome,
    properties.name
  ].filter(value => value !== undefined && value !== null && String(value).trim() !== "");

  return values.flatMap(value => {
    const text = String(value);
    const digits = text.replace(/\D/g, "");
    return [text, normalizeKey(text), digits, digits ? digits.slice(0, 6) : ""].filter(Boolean);
  });
}

function featureLabel(properties: GeoProperties) {
  return String(properties.NM_MUN ?? properties.GVE ?? properties.DRS ?? properties.NOME ?? properties.Nome ?? properties.name ?? "Região");
}

export function ChoroplethMap({
  dataUrl,
  valueMap = {},
  colorScheme = value => {
    if (value === null || value === undefined) return "#94a3b8";
    if (value >= 50) return "#dc2626";
    if (value >= 20) return "#f59e0b";
    if (value >= 5) return "#84cc16";
    return "#14b8a6";
  },
  label = "Mapa",
  className
}: ChoroplethMapProps) {
  const [geoData, setGeoData] = useState<FeatureCollection<Geometry, GeoProperties> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetch(dataUrl);

        if (!response.ok) {
          let errorDetail = response.statusText;
          try {
            const errorJson = await response.json();
            errorDetail = errorJson.error || errorJson.message || errorDetail;
          } catch {
            // Mantem statusText quando a resposta nao for JSON.
          }
          throw new Error(`API error (${response.status}): ${errorDetail}`);
        }

        const data = await response.json();
        if (!active) return;
        setGeoData(data);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erro desconhecido");
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchData();
    return () => {
      active = false;
    };
  }, [dataUrl]);

  const normalizedValueMap = useMemo(() => normalizeValueMap(valueMap), [valueMap]);
  const pathData = useMemo(() => buildPaths(geoData?.features ?? []), [geoData]);

  const getFeatureValue = (properties: GeoProperties): number | null => {
    for (const candidate of featureCandidates(properties)) {
      const value = normalizedValueMap[candidate];
      if (value !== undefined) return value;
    }
    return null;
  };

  const getFeatureColor = (properties: GeoProperties): string => colorScheme(getFeatureValue(properties));

  if (loading) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed p-8 text-muted-foreground ${className}`}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="ml-2">Carregando mapa...</span>
      </div>
    );
  }

  if (error || !geoData) {
    return null;
  }

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="h-[360px] w-full"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={label}
        >
          {pathData.map((item, idx) =>
            item.paths.map((d, pathIdx) => {
              const featureName = featureLabel(item.properties);
              const featureValue = getFeatureValue(item.properties);
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
                  className="transition-all hover:stroke-2 hover:stroke-foreground"
                  data-title={featureName}
                  aria-label={`${featureName}: ${featureValue ?? "sem valor"}`}
                >
                  <title>{`${featureName}: ${featureValue == null ? "sem valor" : featureValue.toLocaleString("pt-BR")}`}</title>
                </path>
              );
            })
          )}
        </svg>
      </div>
    </div>
  );
}
