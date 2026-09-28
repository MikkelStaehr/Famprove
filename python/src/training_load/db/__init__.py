"""The single data layer: every Supabase read/write goes through this package.

Transport is PostgREST over plain HTTP (client.py). One module per table converts between
domain dataclasses and JSON rows; callers never build PostgREST queries themselves.
"""
