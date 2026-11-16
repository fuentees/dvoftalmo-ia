import assert from "node:assert/strict";
import { loadMunicipisShapefile } from "@/lib/shapefiles";

async function verify() {
  const collection = await loadMunicipisShapefile();
  assert.equal(collection.features.length, 645);
  const values = collection.features.flatMap(feature => Object.values(feature.properties ?? {}).filter(value => typeof value === "string"));
  assert.ok(values.includes("Araçatuba"), "The actual UTF-8 DBF must preserve accented municipality names");
  assert.ok(values.includes("São Paulo"));
  assert.ok(values.includes("Águas de Lindóia"));
  assert.equal(values.some(value => /Ã§|Ã£|Ã³|Â/.test(String(value))), false, "CPG encoding must be honored instead of decoding UTF-8 as Windows-1252");
  console.log("Shapefile municipality encoding and coverage tests passed");
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
