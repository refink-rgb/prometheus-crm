-- =============================================
-- Prometheus CRM — Supabase Schema
-- Run this in: Supabase Dashboard > SQL Editor
-- =============================================

-- Brands
CREATE TABLE IF NOT EXISTS brands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Projects (marketing moments)
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID REFERENCES brands(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  due_date DATE NOT NULL,
  font TEXT,
  author TEXT,
  offer TEXT,
  discount TEXT,
  headline TEXT,
  body_copy TEXT,
  cta TEXT,
  target_audience TEXT,
  notes TEXT,
  assigned_designer TEXT,
  -- Current allowed set (see 20260723_add_revisions_stage.sql and
  -- 20260802_remove_done_stage.sql): 'live' is terminal, archiving is is_complete.
  lp_stage TEXT DEFAULT 'brief' CHECK (lp_stage IN ('brief','in_progress','internal_review','client_review','revisions','live')),
  creatives_stage TEXT DEFAULT 'brief' CHECK (creatives_stage IN ('brief','in_progress','internal_review','client_review','revisions','live')),
  lp_url TEXT,
  creatives_notes TEXT,
  shopify_coupon_code TEXT,
  is_complete BOOLEAN DEFAULT FALSE,
  -- Per-stage due dates (see 20260708_brief_restructure.sql)
  stage_brief_due_date DATE,
  stage_in_progress_due_date DATE,
  stage_internal_review_due_date DATE,
  stage_client_review_due_date DATE,
  -- Extended brief fields (see 20260708_brief_restructure.sql)
  product_description TEXT,
  retail_price TEXT,
  offer_dynamics_type TEXT,
  offer_dynamics_detail TEXT,
  competitor_reference TEXT,
  client_ad_inspiration TEXT,
  ad_copy_primary_text TEXT,
  ad_copy_description TEXT,
  ad_copy_url TEXT,
  product_images_link TEXT,
  ad_headlines JSONB,
  ad_subcopies JSONB,
  ad_eyebrows JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Product images
CREATE TABLE IF NOT EXISTS project_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  storage_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Row Level Security (RLS)
-- All authenticated users can read/write everything
-- =============================================

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_images ENABLE ROW LEVEL SECURITY;

-- Brands
CREATE POLICY "auth_select_brands" ON brands FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_brands" ON brands FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_brands" ON brands FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_brands" ON brands FOR DELETE TO authenticated USING (true);

-- Projects
CREATE POLICY "auth_select_projects" ON projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_projects" ON projects FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_projects" ON projects FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete_projects" ON projects FOR DELETE TO authenticated USING (true);

-- Project images
CREATE POLICY "auth_select_project_images" ON project_images FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_project_images" ON project_images FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_delete_project_images" ON project_images FOR DELETE TO authenticated USING (true);

-- =============================================
-- Storage bucket for product images
-- Run AFTER tables are created
-- =============================================

-- Create the storage bucket (run in SQL editor):
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-images', 'project-images', true)
ON CONFLICT DO NOTHING;

-- Allow authenticated users to upload
CREATE POLICY "auth_upload_images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-images');

-- Allow public read of images
CREATE POLICY "public_read_images" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'project-images');

-- Allow authenticated users to delete their uploads
CREATE POLICY "auth_delete_images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'project-images');
