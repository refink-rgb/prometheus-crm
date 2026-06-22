-- Adds a per-project Shopify coupon code field.
-- Captured on each project before the landing page goes live (3rd stage / "Under Review").
-- Run in Supabase SQL Editor.

alter table projects
  add column if not exists shopify_coupon_code text;
