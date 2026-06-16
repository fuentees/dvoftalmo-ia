"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";

export interface PagedColumn<T> {
  key: keyof T & string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  render?: (value: T[keyof T], row: T) => React.ReactNode;
}

interface PagedTableProps<T> {
  rows: T[];
  columns: PagedColumn<T>[];
  defaultPageSize?: number;
  defaultSortKey?: keyof T & string;
  defaultSortDir?: "asc" | "desc";
  rowKey?: (row: T, index: number) => string;
  emptyText?: string;
  stickyHeader?: boolean;
  className?: string;
}

const PAGE_SIZES = [20, 40, 50, 100] as const;

function SortIcon({ state }: { state: "asc" | "desc" | "none" }) {
  if (state === "asc")  return <ChevronUp   className="h-3 w-3 shrink-0" />;
  if (state === "desc") return <ChevronDown className="h-3 w-3 shrink-0" />;
  return <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />;
}

export function PagedTable<T extends Record<string, unknown>>({
  rows,
  columns,
  defaultPageSize = 20,
  defaultSortKey,
  defaultSortDir = "desc",
  rowKey,
  emptyText = "Nenhum registro encontrado.",
  stickyHeader = true,
  className
}: PagedTableProps<T>) {
  const [page,     setPage]     = useState(0);
  const [pageSize, setPageSize] = useState<number | "all">(defaultPageSize);
  const [sortKey,  setSortKey]  = useState<string | null>(defaultSortKey ?? null);
  const [sortDir,  setSortDir]  = useState<"asc" | "desc">(defaultSortDir);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), "pt-BR", { numeric: true });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const totalPages = pageSize === "all" ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage   = Math.min(page, totalPages - 1);
  const visible    = pageSize === "all"
    ? sorted
    : sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  function goPage(n: number) { setPage(Math.max(0, Math.min(n, totalPages - 1))); }

  const thCls = (col: PagedColumn<T>) =>
    `px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground select-none ${
      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
    } ${col.sortable !== false ? "cursor-pointer hover:text-foreground" : ""}`;

  const tdCls = (col: PagedColumn<T>) =>
    `px-3 py-2 text-sm ${col.align === "right" ? "text-right tabular-nums" : col.align === "center" ? "text-center" : ""}`;

  return (
    <div className={`flex flex-col gap-0 ${className ?? ""}`}>
      {/* Tabela */}
      <div className="overflow-auto rounded-t-md border">
        <table className="w-full min-w-max">
          <thead className={stickyHeader ? "sticky top-0 z-10 bg-background" : ""}>
            <tr className="border-b bg-muted/40">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={thCls(col)}
                  onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable !== false && (
                      <SortIcon state={sortKey === col.key ? sortDir : "none"} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {emptyText}
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row, i) : i}
                  className="border-b last:border-0 transition-colors hover:bg-muted/20"
                >
                  {columns.map((col) => (
                    <td key={col.key} className={tdCls(col)}>
                      {col.render
                        ? col.render(row[col.key], row)
                        : (row[col.key] == null ? "—" : String(row[col.key]))}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Controles de paginação */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-md border border-t-0 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Linhas por página:</span>
          {PAGE_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => { setPageSize(s); setPage(0); }}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                pageSize === s
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => setPageSize("all")}
            className={`rounded px-2 py-0.5 font-medium transition-colors ${
              pageSize === "all"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted hover:text-foreground"
            }`}
          >
            Todos
          </button>
        </div>

        {pageSize !== "all" && totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              disabled={safePage === 0}
              onClick={() => goPage(safePage - 1)}
              className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
            >
              ‹
            </button>
            <span className="px-1">
              {(safePage + 1).toLocaleString("pt-BR")} / {totalPages.toLocaleString("pt-BR")}
            </span>
            <button
              disabled={safePage + 1 >= totalPages}
              onClick={() => goPage(safePage + 1)}
              className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
            >
              ›
            </button>
          </div>
        )}

        <span>
          {pageSize === "all"
            ? `${sorted.length.toLocaleString("pt-BR")} registro(s)`
            : `${(safePage * (pageSize as number) + 1).toLocaleString("pt-BR")}–${Math.min((safePage + 1) * (pageSize as number), sorted.length).toLocaleString("pt-BR")} de ${sorted.length.toLocaleString("pt-BR")}`}
        </span>
      </div>
    </div>
  );
}
