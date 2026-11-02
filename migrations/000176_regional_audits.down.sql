-- Reverses 000176_regional_audits. This deletes stored audit reports (plans, evidence
-- metadata, AI findings). Screenshots are files on the auditor worker's data volume and
-- are not touched; remove that directory separately if the reports are being retired.
DROP TABLE IF EXISTS public.regional_audits;
