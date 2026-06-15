import "dotenv/config";
import { syncIbgePopulation, syncIbgePopulationRange } from "@/services/ibge-population";

function readArg(name: string, fallback: string) {
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed?.split("=").slice(1).join("=") || fallback;
}

async function main() {
  const year = Number(readArg("--year", String(new Date().getFullYear() - 1)));
  const startArg = process.argv.find((arg) => arg.startsWith("--start="));
  const endArg = process.argv.find((arg) => arg.startsWith("--end="));
  const ufCode = readArg("--uf", "35");
  const result = startArg && endArg
    ? await syncIbgePopulationRange(ufCode, Number(readArg("--start", String(year))), Number(readArg("--end", String(year))))
    : await syncIbgePopulation(ufCode, year);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
