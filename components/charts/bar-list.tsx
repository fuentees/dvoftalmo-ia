import { cn } from "@/lib/utils";
import { CHART } from "@/lib/chart-palette";

const fmt = (v: number) => v.toLocaleString("pt-BR");
const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export interface BarListItem {
  label: string;
  value: number;
}

/**
 * Barras horizontais em HTML: nome, barra e valor escrito (com % do total).
 * Uma série só, uma cor só. O texto acompanha a escala da tela, ao contrário do SVG.
 */
export function BarList({
  items,
  color = CHART.primary,
  showPercent = true,
  maxItems,
  emptyText = "Sem dados no recorte."
}: {
  items: BarListItem[];
  color?: string;
  showPercent?: boolean;
  maxItems?: number;
  emptyText?: string;
}) {
  const visiveis = maxItems ? items.slice(0, maxItems) : items;
  const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
  const maior = Math.max(1, ...visiveis.map((i) => Number(i.value) || 0));
  if (!visiveis.length) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="flex flex-col gap-1">
      {visiveis.map((item) => {
        const v = Number(item.value) || 0;
        const parte = total ? (v / total) * 100 : 0;
        const descricao = `${item.label}: ${fmt(v)} casos${showPercent ? ` (${pct(parte)})` : ""}`;
        return (
          <li
            key={item.label}
            title={descricao}
            aria-label={descricao}
            className="grid grid-cols-[minmax(7rem,13rem)_1fr_10rem] items-center gap-3 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60"
          >
            <span className="truncate">{item.label}</span>
            <span className="h-[18px] rounded-r-[4px] bg-muted/50" aria-hidden="true">
              <span className="block h-full rounded-r-[4px]" style={{ width: `${(v / maior) * 100}%`, minWidth: v > 0 ? 2 : 0, background: color }} />
            </span>
            <span className="num whitespace-nowrap text-right">
              {fmt(v)}
              {showPercent && <span className="ml-1.5 text-muted-foreground">{pct(parte)}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Cores para partes de um todo (sexo etc.): validadas para daltonismo e contraste. */
const CORES_PARTES = [CHART.catTeal, CHART.catOrange];

/**
 * Barra única dividida (parte do todo, até ~4 partes), com legenda que traz número e %.
 * Partes como "Ignorado" vão em cinza para não competir com as categorias reais.
 */
export function SplitBar({ items, neutral = /ignor|n[aã]o inform|branco/i }: { items: BarListItem[]; neutral?: RegExp }) {
  const total = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
  if (!total) return <p className="py-6 text-center text-sm text-muted-foreground">Sem dados no recorte.</p>;
  let k = 0;
  const partes = items
    .filter((i) => Number(i.value) > 0)
    .map((i) => ({ ...i, cor: neutral.test(i.label) ? CHART.neutral : CORES_PARTES[k++ % CORES_PARTES.length], parte: (Number(i.value) / total) * 100 }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label={partes.map((p) => `${p.label} ${pct(p.parte)}`).join(", ")}>
        {partes.map((p) => (
          <span key={p.label} title={`${p.label}: ${fmt(p.value)} (${pct(p.parte)})`} className="h-full first:rounded-l-md last:rounded-r-md" style={{ width: `${p.parte}%`, background: p.cor }} />
        ))}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {partes.map((p) => (
          <li key={p.label} className="flex items-baseline gap-2.5">
            <span className="h-3 w-3 shrink-0 translate-y-0.5 rounded-sm" style={{ background: p.cor }} aria-hidden="true" />
            <span className="text-sm">{p.label}</span>
            <span className="num ml-auto text-sm">{fmt(p.value)}</span>
            <span className={cn("num w-14 text-right text-sm text-muted-foreground")}>{pct(p.parte)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
