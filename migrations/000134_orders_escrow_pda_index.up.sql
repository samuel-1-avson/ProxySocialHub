-- Escrow listener / activator lookups by PDA (partial index).

CREATE INDEX IF NOT EXISTS idx_orders_escrow_pda
    ON public.orders (escrow_pda)
    WHERE escrow_pda IS NOT NULL AND escrow_pda <> '';
