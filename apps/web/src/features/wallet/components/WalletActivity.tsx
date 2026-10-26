'use client';

import { useMemo, useState } from 'react';
import { getWalletTransactionsPage } from '@/lib/api';
import { ExternalLink, History } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { getSolscanTxUrl } from '@/lib/solscan';
import { formatSOL } from '../utils';
import { DataTable } from '@/components/patterns/DataTable';
import { StatusBadge, type StatusVariant } from '@/components/ui/StatusBadge';

type WalletTransaction = {
  id: string;
  description?: string | null;
  amount?: number | string | null;
  status?: string | null;
  created_at: string;
  solscan_url?: string | null;
  tx_hash?: string | null;
};

type WalletActivityProps = {
  transactions: WalletTransaction[] | null | undefined;
  initialNextCursor?: string | null;
};

function txStatusVariant(status?: string | null): StatusVariant {
  const s = (status ?? '').toLowerCase();
  if (s === 'success' || s === 'completed' || s === 'settled') return 'verified';
  if (s === 'failed') return 'error';
  return 'pending';
}

export function WalletActivity({ transactions, initialNextCursor }: WalletActivityProps) {
  // W-21: server-side keyset pages appended on demand; the first page
  // still arrives embedded in GET /wallet.
  const [extraRows, setExtraRows] = useState<WalletTransaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const rows = [...(transactions ?? []), ...extraRows];

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getWalletTransactionsPage(cursor);
      setExtraRows((prev) => [...prev, ...(page.transactions as WalletTransaction[])]);
      setCursor(page.nextCursor || null);
    } finally {
      setLoadingMore(false);
    }
  };

  const columns = useMemo<ColumnDef<WalletTransaction, unknown>[]>(
    () => [
      {
        id: 'description',
        header: 'Description',
        meta: { priority: 1 },
        cell: ({ row }) => {
          const tx = row.original;
          return (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{tx.description ?? 'Transaction'}</p>
              <p className="font-mono text-xs text-muted-foreground">{tx.id.slice(0, 12)}…</p>
              {tx.solscan_url || tx.tx_hash ? (
                <a
                  href={tx.solscan_url || getSolscanTxUrl(tx.tx_hash!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  On-chain <ExternalLink size={10} aria-hidden />
                </a>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'amount',
        header: 'Amount',
        meta: { priority: 1, mono: true, align: 'right' },
        cell: ({ row }) => {
          const amount = Number(row.original.amount || 0);
          return (
            <span className={amount > 0 ? 'text-[var(--success)]' : 'text-[var(--destructive)]'}>
              {(amount > 0 ? '+' : '') + formatSOL(amount)}
            </span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        meta: { priority: 1, align: 'center' },
        cell: ({ row }) => (
          <StatusBadge
            status={txStatusVariant(row.original.status)}
            label={row.original.status ?? 'pending'}
            size="sm"
          />
        ),
      },
      {
        id: 'time',
        header: 'Time',
        meta: { priority: 2, mono: true, align: 'right' },
        cell: ({ row }) => (
          <div>
            <p className="text-sm">{new Date(row.original.created_at).toLocaleDateString()}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(row.original.created_at).toLocaleTimeString()}
            </p>
          </div>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
          <History size={16} className="text-primary" aria-hidden /> Settlement ledger
        </h3>
        <span className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-secondary px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          Live
        </span>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        emptyTitle="No activity yet"
        emptyDescription="Deposits, withdrawals, and settlements will show up here."
        getRowId={(row) => row.id}
        density="compact"
        renderMobileCard={(tx) => {
          const amount = Number(tx.amount || 0);
          return (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{tx.description ?? 'Transaction'}</p>
                  <p className="font-mono text-xs text-muted-foreground">{tx.id.slice(0, 12)}…</p>
                </div>
                <StatusBadge
                  status={txStatusVariant(tx.status)}
                  label={tx.status ?? 'pending'}
                  size="sm"
                />
              </div>
              <div className="flex items-center justify-between font-mono text-sm">
                <span className={amount > 0 ? 'text-[var(--success)]' : 'text-[var(--destructive)]'}>
                  {(amount > 0 ? '+' : '') + formatSOL(amount)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(tx.created_at).toLocaleString()}
                </span>
              </div>
            </div>
          );
        }}
      />
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full rounded-[var(--radius-md)] border border-border px-3 py-2 text-xs font-medium uppercase tracking-wider text-primary disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
