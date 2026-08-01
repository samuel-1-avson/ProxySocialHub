"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/EmptyState";
import { ErrorState } from "@/components/patterns/ErrorState";

export type DataTableDensity = "comfortable" | "compact";

export interface DataTableColumnMeta {
  /** 1 = never hide … 4 = hide first on narrow viewports */
  priority?: 1 | 2 | 3 | 4;
  mono?: boolean;
  align?: "left" | "right" | "center";
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  density?: DataTableDensity;
  /** Show column visibility menu */
  enableColumnVisibility?: boolean;
  className?: string;
  /** Mobile card renderer — when provided, table swaps to cards below md */
  renderMobileCard?: (row: TData) => ReactNode;
  getRowId?: (row: TData, index: number) => string;
}

/**
 * Canonical DataTable — reconstruction plan §14.8 / §20.
 * Requires `@tanstack/react-table`.
 */
export function DataTable<TData>({
  columns,
  data,
  loading = false,
  error,
  onRetry,
  emptyTitle = "No results",
  emptyDescription = "Nothing matches the current filters.",
  emptyActionLabel,
  onEmptyAction,
  density = "comfortable",
  enableColumnVisibility = false,
  className,
  renderMobileCard,
  getRowId,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });

  const rowHeight = density === "compact" ? "h-10" : "h-12";
  const skeletonRows = useMemo(() => Array.from({ length: 5 }, (_, i) => i), []);

  if (error) {
    return <ErrorState message={error} onRetry={onRetry} className={className} />;
  }

  if (!loading && data.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
        className={className}
      />
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {enableColumnVisibility ? (
        <div className="flex justify-end">
          <details className="relative">
            <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm hover:bg-secondary">
              <Columns3 size={14} aria-hidden />
              Columns
            </summary>
            <div className="absolute right-0 z-20 mt-1 min-w-[180px] rounded-[var(--radius-md)] border border-border bg-card p-2 shadow-[var(--shadow-pop)]">
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((column) => (
                  <label
                    key={column.id}
                    className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm hover:bg-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                      className="accent-[var(--primary)]"
                    />
                    {typeof column.columnDef.header === "string"
                      ? column.columnDef.header
                      : column.id}
                  </label>
                ))}
            </div>
          </details>
        </div>
      ) : null}

      {renderMobileCard ? (
        <div className="space-y-2 md:hidden">
          {loading
            ? skeletonRows.map((i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-[var(--radius-md)] border border-border bg-secondary"
                />
              ))
            : table.getRowModel().rows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-[var(--radius-md)] border border-border bg-card p-4"
                >
                  {renderMobileCard(row.original)}
                </div>
              ))}
        </div>
      ) : null}

      <div
        className={cn(
          "overflow-x-auto rounded-[var(--radius-lg)] border border-border",
          renderMobileCard && "hidden md:block"
        )}
      >
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-secondary/95 backdrop-blur-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as DataTableColumnMeta | undefined;
                  const align = meta?.align ?? "left";
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={cn(
                        "px-3 py-2 font-medium text-muted-foreground",
                        align === "right" && "text-right",
                        align === "center" && "text-center",
                        meta?.priority === 4 && "hidden xl:table-cell",
                        meta?.priority === 3 && "hidden lg:table-cell"
                      )}
                      aria-sort={
                        header.column.getIsSorted() === "asc"
                          ? "ascending"
                          : header.column.getIsSorted() === "desc"
                            ? "descending"
                            : header.column.getCanSort()
                              ? "none"
                              : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-2 h-8 gap-1 px-2 font-medium text-muted-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === "asc" ? (
                            <ArrowUp size={12} aria-hidden />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ArrowDown size={12} aria-hidden />
                          ) : (
                            <ArrowUpDown size={12} aria-hidden className="opacity-40" />
                          )}
                        </Button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading
              ? skeletonRows.map((i) => (
                  <tr key={i} className={cn("border-b border-border", rowHeight)}>
                    {columns.map((_, j) => (
                      <td key={j} className="px-3">
                        <div className="h-4 w-3/4 animate-pulse rounded bg-secondary" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border transition-colors hover:bg-secondary/60",
                      rowHeight
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as DataTableColumnMeta | undefined;
                      const align = meta?.align ?? "left";
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            "px-3 text-foreground",
                            meta?.mono && "font-mono tabular-nums",
                            align === "right" && "text-right",
                            align === "center" && "text-center",
                            meta?.priority === 4 && "hidden xl:table-cell",
                            meta?.priority === 3 && "hidden lg:table-cell"
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
