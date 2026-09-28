-- =============================================================================
-- Famprove M2: dashboard fields on daily_load
-- =============================================================================
-- Additive only. All three columns are nullable with no default, so the M1 `compute`
-- (whose upsert payload lacks these keys) keeps working until the M2 Python ships:
-- PostgREST's merge-duplicates upsert only updates the columns present in the payload.
--
-- Calculation ownership is unchanged: Python computes every value
-- (training_load.domain.form for ctl_ramp_7d / form_zone, cli.compute for computed_at).
-- No functions, triggers, CHECKs or defaults that would compute anything in SQL.
--
-- form_zone is plain text on purpose (no CHECK, no enum type): the label set is owned by
-- training_load.domain.form.FormZone and may change without a migration. A CHECK would
-- make a Python-side rename a two-step deploy for a single-user, service-role-only table.
--
-- Access control: unchanged. RLS stays enabled with no policies; table-level grants from
-- 20260928120000_training_load_schema.sql cover new columns. weekly_load selects explicit
-- columns, so it is unaffected.
--
-- Indexes: none added. The dashboard filters/orders daily_load only by date (primary key);
-- the new columns are never used in WHERE / ORDER BY.
-- =============================================================================

alter table public.daily_load
  add column computed_at  timestamptz,
  add column ctl_ramp_7d  double precision,
  add column form_zone    text;

comment on column public.daily_load.computed_at is
  'UTC start time of the compute run that wrote this row. Identical on every row of one run. Null only for rows written before M2. The dashboard marks data stale when now() - max(computed_at) > 26 h.';
comment on column public.daily_load.ctl_ramp_7d is
  'ctl of this date minus ctl of the date 7 days earlier (TSS/day per week). Null for the first 7 days of the series (2026-01-01 .. 2026-01-07). Computed in Python (training_load.domain.form.ctl_ramp).';
comment on column public.daily_load.form_zone is
  'Form-zone key derived from tsb and ctl of the same day (training_load.domain.form.form_zone, values = FormZone enum). Null when the zone is undefined (e.g. ctl too small). Plain text: the label set is owned by Python.';
