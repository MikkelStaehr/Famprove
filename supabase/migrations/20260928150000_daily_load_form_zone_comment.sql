-- Comment-only correction: form_zone is always set by compute (training_load.domain.form
-- returns a zone for every day; percent-of-CTL form is 0 when CTL is 0). Null only for rows
-- written before M2.
comment on column public.daily_load.form_zone is
  'Form-zone key from tsb (and ctl in percent mode) of the same day: training_load.domain.form.form_zone, values = FormZone enum (intervals.icu bands). Always set by compute; null only for pre-M2 rows. Plain text: the label set is owned by Python.';
