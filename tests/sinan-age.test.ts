import assert from "node:assert/strict";
import { decodeSinanAgeYears, tracomaAgeGroup } from "@/lib/sinan-age";

assert.equal(decodeSinanAgeYears("5"), 5, "idade direta em anos");
assert.equal(decodeSinanAgeYears("0005"), 5, "idade direta com zeros à esquerda");
assert.equal(decodeSinanAgeYears("4005"), 5, "NU_IDADE_N 4005 = 5 anos");
assert.equal(decodeSinanAgeYears("4010"), 10, "NU_IDADE_N 4010 = 10 anos");
assert.equal(decodeSinanAgeYears("4060"), 60, "NU_IDADE_N 4060 = 60 anos");
assert.equal(decodeSinanAgeYears("3011"), 0, "NU_IDADE_N 3011 = 11 meses");
assert.equal(decodeSinanAgeYears("2015"), 0, "NU_IDADE_N 2015 = 15 dias");
assert.equal(decodeSinanAgeYears("1008"), 0, "NU_IDADE_N 1008 = 8 horas");
assert.equal(decodeSinanAgeYears("4999"), null, "idade codificada inválida");

assert.equal(tracomaAgeGroup(decodeSinanAgeYears("4005")), "5 a 9 anos");
assert.equal(tracomaAgeGroup(decodeSinanAgeYears("4010")), "10 a 14 anos");
assert.equal(tracomaAgeGroup(decodeSinanAgeYears("3011")), "Menor de 1 ano");
assert.equal(tracomaAgeGroup(decodeSinanAgeYears("4060")), "60 anos ou mais");

console.log("sinan age tests passed ✓");
