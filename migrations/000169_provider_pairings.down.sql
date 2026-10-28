-- Reverses 000169_provider_pairings. Pending requests are short-lived (10 minutes), so
-- dropping the table only cancels pairings in flight; tokens and nodes already minted
-- by redeemed pairings are ordinary provider_tokens/provider_nodes rows and stay.
DROP TABLE IF EXISTS public.provider_pairings;
