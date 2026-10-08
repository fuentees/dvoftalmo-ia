import assert from "node:assert/strict";
import { buildShapeValueMap } from "../lib/rate-map-values";

const values = buildShapeValueMap([
  { codigoIbge: "3509502", municipio: "Campinas", gve: "CAMPINAS", rate: 0 },
  { codigoIbge: "3500600", municipio: "Águas de São Pedro", gve: "PIRACICABA", rate: null },
  { codigoIbge: "3500709", municipio: "Agudos", gve: "BAURU", rate: NaN },
  { codigoIbge: "3500808", municipio: "Alfredo Marcondes", gve: "PRUDENTE", rate: -1 }
], "rate");
assert.equal(values["3509502"], 0);
assert.equal(values["350950"], 0);
assert.equal(values["3500600"], undefined);
assert.equal(values["3500709"], undefined);
assert.equal(values["3500808"], undefined);
assert.equal(values.PIRACICABA, undefined);
assert.equal(values.BAURU, undefined);
const gves = buildShapeValueMap([{ gve: "SÃO PAULO", rate: 10 }], "rate");
assert.equal(gves["sao paulo"], 10);
console.log("Rate map missing-value tests passed");
