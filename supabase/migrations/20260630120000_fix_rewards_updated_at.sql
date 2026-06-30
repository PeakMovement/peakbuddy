-- Fix: public.rewards was first created (migration 20260623170000) WITHOUT an
-- updated_at column. A later migration (20260628154410) added a BEFORE UPDATE
-- trigger that sets NEW.updated_at, plus a CREATE TABLE IF NOT EXISTS that was a
-- no-op because the table already existed (so the column was never added).
-- Result: any UPDATE on rewards (edit/deactivate a reward) errors with
-- "record new has no field updated_at". Add the column idempotently.
ALTER TABLE public.rewards
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
