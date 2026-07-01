export const TRACOMA_AGE_ORDER = [
  "Menor de 1 ano",
  "1 a 4 anos",
  "5 a 9 anos",
  "10 a 14 anos",
  "15 a 19 anos",
  "20 a 39 anos",
  "40 a 59 anos",
  "60 anos ou mais",
  "Não informado"
];

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function decodeSinanAgeYears(value: unknown): number | null {
  const direct = toNumber(value);
  if (direct == null || direct < 0) return null;

  if (direct <= 130) return Math.trunc(direct);

  const digits = String(value ?? "").trim().replace(/\D/g, "");
  if (digits.length !== 4) return null;

  const unit = Number(digits[0]);
  const amount = Number(digits.slice(1));
  if (!Number.isFinite(unit) || !Number.isFinite(amount) || amount < 0) return null;

  // SINAN NU_IDADE_N: 1=hours, 2=days, 3=months, 4=years.
  if (unit >= 1 && unit <= 3) return 0;
  if (unit === 4 && amount <= 130) return amount;
  return null;
}

export function tracomaAgeGroup(age: number | null) {
  if (age == null) return "Não informado";
  if (age < 1) return "Menor de 1 ano";
  if (age <= 4) return "1 a 4 anos";
  if (age <= 9) return "5 a 9 anos";
  if (age <= 14) return "10 a 14 anos";
  if (age <= 19) return "15 a 19 anos";
  if (age <= 39) return "20 a 39 anos";
  if (age <= 59) return "40 a 59 anos";
  return "60 anos ou mais";
}
