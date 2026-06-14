"use client";

import type { Feature, FeatureCollection, Geometry } from "geojson";

type GeoShape = FeatureCollection<Geometry, any> | Feature<Geometry, any>;

export type StateMapProps = {
  geoJson: GeoShape;
  fillColor?: string;
  strokeColor?: string;
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

function extractFeatures(geoJson: GeoShape): Array<Feature<Geometry, any>> {
  if (geoJson.type === "FeatureCollection") {
    return geoJson.features;
  }

  return [geoJson];
}

function buildPaths(geoJson: GeoShape) {
  const features = extractFeatures(geoJson);
  const rings = features.flatMap((feature) => getRings(feature.geometry));

  const allPoints = rings.flatMap((ring) => ring.map(([lng, lat]) => ({ lng, lat })));
  if (allPoints.length === 0) {
    return [];
  }

  const minLng = Math.min(...allPoints.map((point) => point.lng));
  const maxLng = Math.max(...allPoints.map((point) => point.lng));
  const minLat = Math.min(...allPoints.map((point) => point.lat));
  const maxLat = Math.max(...allPoints.map((point) => point.lat));

  const scaleX = (SVG_WIDTH - 2 * MARGIN) / (maxLng - minLng);
  const scaleY = (SVG_HEIGHT - 2 * MARGIN) / (maxLat - minLat);
  const scale = Math.min(scaleX, scaleY);

  return rings.map((ring) => {
    const path = ring
      .map(([lng, lat], index) => {
        const x = (lng - minLng) * scale + MARGIN;
        const y = (maxLat - lat) * scale + MARGIN;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

    return `${path} Z`;
  });
}

export function StateMap({ geoJson, fillColor = "#0f766e", strokeColor = "#115e59", className }: StateMapProps) {
  const paths = buildPaths(geoJson);

  if (paths.length === 0) {
    return <div className={className}>Não foi possível renderizar o mapa.</div>;
  }

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="h-[360px] w-full" preserveAspectRatio="xMidYMid meet">
          {paths.map((d, index) => (
            <path
              key={index}
              d={d}
              fill={fillColor}
              fillOpacity="0.18"
              stroke={strokeColor}
              strokeWidth="1.8"
              strokeLinejoin="round"
              fillRule="evenodd"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
