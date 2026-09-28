"""Famprove training load: collectors + compute for the daily TSS / CTL / ATL / TSB series.

Layers (imports only point downward, never sideways into cli, no cycles):

    cli      -> config, http, sources, domain, db     orchestration: args, env, wiring, logging
    db       -> domain, http                          the ONLY place that talks to Supabase
    sources  -> domain, http                          intervals.icu, Google Drive, sheet parser
    domain   -> stdlib only                           pure calculations, no I/O
    config, http, narrow                              settings, HTTP seam, JSON narrowing

Calculation owners (one each):
    per-set strength score ...... sources.strength_sheet (the original strength_collector formula)
    filled weeks / blocks / K ... domain.strength
    cycling filter + daily sum .. domain.cycling
    CTL / ATL / TSB ............. domain.load
    daily series assembly ....... domain.daily
    ISO-week sum ................ SQL view public.weekly_load (agreed decision)
"""
