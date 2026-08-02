-- DB-01: additive double-entry journal (dual-write alongside wallet_ledger_entries).

CREATE TABLE IF NOT EXISTS public.ledger_accounts (
    code        VARCHAR(16) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    account_type VARCHAR(20) NOT NULL, -- asset | liability | income | expense
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.ledger_accounts (code, name, account_type) VALUES
    ('1000', 'treasury_cash', 'asset'),
    ('2100', 'user_wallet_liability', 'liability'),
    ('2200', 'escrow_liability', 'liability'),
    ('4000', 'platform_revenue', 'income')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ledger_journals (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_ref VARCHAR(128),
    entry_type   VARCHAR(50) NOT NULL,
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_journals_ref ON public.ledger_journals (external_ref);
CREATE INDEX IF NOT EXISTS idx_ledger_journals_type ON public.ledger_journals (entry_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ledger_journal_lines (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_id      UUID NOT NULL REFERENCES public.ledger_journals(id),
    account_code    VARCHAR(16) NOT NULL REFERENCES public.ledger_accounts(code),
    wallet_id       UUID REFERENCES public.wallets(id),
    -- Signed lamports: debit positive for assets/expenses, credit positive for liabilities/income
    -- Convention: amount_lamports > 0 = debit, amount_lamports < 0 = credit.
    amount_lamports BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_journal_line_nonzero CHECK (amount_lamports <> 0)
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON public.ledger_journal_lines (journal_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.ledger_journal_lines (account_code);
CREATE INDEX IF NOT EXISTS idx_journal_lines_wallet ON public.ledger_journal_lines (wallet_id)
    WHERE wallet_id IS NOT NULL;

-- Enforce balanced journals (sum of lines = 0).
CREATE OR REPLACE FUNCTION public.enforce_journal_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    bal BIGINT;
BEGIN
    SELECT COALESCE(SUM(amount_lamports), 0) INTO bal
    FROM public.ledger_journal_lines
    WHERE journal_id = NEW.journal_id;
    -- Trigger fires per line insert; only check after statement via constraint trigger alternative.
    -- Use deferred check: allow unbalanced mid-insert within same transaction via AFTER INSERT STATEMENT.
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_journal_balanced_stmt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT journal_id, SUM(amount_lamports) AS s
        FROM public.ledger_journal_lines
        WHERE journal_id IN (SELECT DISTINCT journal_id FROM new_table)
        GROUP BY journal_id
        HAVING SUM(amount_lamports) <> 0
    LOOP
        RAISE EXCEPTION 'ledger journal % is unbalanced (sum=%)', r.journal_id, r.s
            USING ERRCODE = 'integrity_constraint_violation';
    END LOOP;
    RETURN NULL;
END;
$$;

-- Prefer app-level balance assert; statement trigger needs transition tables (PG 10+).
DROP TRIGGER IF EXISTS trg_journal_lines_balanced ON public.ledger_journal_lines;
CREATE TRIGGER trg_journal_lines_balanced
    AFTER INSERT ON public.ledger_journal_lines
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.enforce_journal_balanced_stmt();

-- Append-only on journal lines (same GUC escape as wallet ledger).
CREATE OR REPLACE FUNCTION public.prevent_journal_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    allow_mode text;
BEGIN
    allow_mode := COALESCE(current_setting('app.wallet_ledger_allow_mutate', true), '');
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'ledger_journal_lines is append-only: UPDATE denied'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF allow_mode IN ('archive', 'gdpr_delete') THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'ledger_journal_lines is append-only: DELETE denied'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_lines_append_only ON public.ledger_journal_lines;
CREATE TRIGGER trg_journal_lines_append_only
    BEFORE UPDATE OR DELETE ON public.ledger_journal_lines
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_journal_line_mutation();

COMMENT ON TABLE public.ledger_journals IS 'DB-01 double-entry journal headers (dual-write with wallet_ledger_entries).';
