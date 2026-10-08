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
assert.equal(decodeSinanAgeYears("1023"), 0, "23 horas válidas");
assert.equal(decodeSinanAgeYears("2030"), 0, "30 dias válidos");
assert.equal(decodeSinanAgeYears("1024"), 0, "24 horas ainda são menos de um ano");
assert.equal(decodeSinanAgeYears("2031"), 0, "31 dias ainda são menos de um ano");
assert.equal(decodeSinanAgeYears("2090"), 0, "90 dias ainda são menos de um ano");
assert.equal(decodeSinanAgeYears("2365"), 1, "dias convertidos para anos");
assert.equal(decodeSinanAgeYears("3012"), 1, "12 meses equivalem a um ano");
assert.equal(decodeSinanAgeYears("3024"), 2, "24 meses equivalem a dois anos");
assert.equal(decodeSinanAgeYears("3999"), 83, "999 meses são convertidos conforme a unidade");
assert.equal(decodeSinanAgeYears("2999"), 2, "999 dias são convertidos conforme a unidade");
assert.equal(decodeSinanAgeYears("1999"), 0, "999 horas ainda são menos de um ano");
assert.equal(decodeSinanAgeYears("4000"), 0, "zero anos válido");
assert.equal(decodeSinanAgeYears("4130"), 130, "limite superior em anos");
for (const invalid of ["4131", "5001", "4005.0", " ", null]) {
  assert.equal(decodeSinanAgeYears(invalid), null, `idade ausente ou codificação inválida: ${invalid}`);
}

assert.equal(tracomaAgeGroup(decodeSinanAgeYears("4005")), "5 a 9 anos");
assert.equal(tracomaAgeGroup(decodeSinanAgeYears("4010")), "10 a 14 anos");
assert.equal(tracomaAgeGroup(decodeSinanAgeYears("3011")), "Menor de 1 ano");
assert.equal(tracomaAgeGroup(decodeSinanAgeYears("4060")), "60 anos ou mais");
assert.equal(tracomaAgeGroup(decodeSinanAgeYears("3999")), "60 anos ou mais");

console.log("sinan age tests passed ✓");
