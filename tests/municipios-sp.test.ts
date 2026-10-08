import assert from "node:assert/strict";
import { gvePorCodigo, infoMunicipio, listarGvesSp, listarMunicipiosSp, nomeMunicipio } from "../lib/municipios-sp";

assert.equal(listarMunicipiosSp().length, 645);
assert.equal(listarGvesSp().length, 28);
assert.equal(new Set(listarMunicipiosSp().map((municipio) => municipio.codigo)).size, 645);

assert.deepEqual(infoMunicipio("3550308"), infoMunicipio("355030"));
assert.equal(nomeMunicipio("3550308"), "São Paulo");
assert.equal(gvePorCodigo("3509502"), "CAMPINAS");
assert.equal(gvePorCodigo("350950"), "CAMPINAS");
assert.deepEqual(infoMunicipio(" 3550308 "), infoMunicipio("355030"));
assert.equal(infoMunicipio("35503080"), null);
assert.equal(infoMunicipio(""), null);
assert.equal(infoMunicipio(null), null);

console.log("municipios SP tests passed");
