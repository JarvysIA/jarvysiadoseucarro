
CREATE TABLE public.jarvys_maintenance_corpus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  brand text NOT NULL,
  model_group text NOT NULL,
  generation_range text,
  year_start int,
  year_end int,
  mechanical_families_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  coverage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_type text NOT NULL DEFAULT 'jarvys_pdf_v1',
  version text NOT NULL DEFAULT '1.0.0',
  file_name text,
  storage_path text,
  extracted_text text,
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_score int NOT NULL DEFAULT 0,
  reviewed_by_admin boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_corpus_quality_score CHECK (quality_score BETWEEN 0 AND 100),
  CONSTRAINT chk_corpus_source_type CHECK (source_type IN ('jarvys_pdf_v1','manual_oficial','curadoria','terceiros')),
  CONSTRAINT chk_corpus_year_start CHECK (year_start IS NULL OR year_start BETWEEN 1980 AND 2100),
  CONSTRAINT chk_corpus_year_end CHECK (year_end IS NULL OR year_end BETWEEN 1980 AND 2100),
  CONSTRAINT chk_corpus_year_range CHECK (year_start IS NULL OR year_end IS NULL OR year_start <= year_end),
  CONSTRAINT chk_corpus_families_array CHECK (jsonb_typeof(mechanical_families_json) = 'array'),
  CONSTRAINT chk_corpus_coverage_object CHECK (jsonb_typeof(coverage_json) = 'object'),
  CONSTRAINT chk_corpus_summary_object CHECK (jsonb_typeof(summary_json) = 'object')
);

GRANT SELECT ON public.jarvys_maintenance_corpus TO authenticated;
GRANT ALL ON public.jarvys_maintenance_corpus TO service_role;

ALTER TABLE public.jarvys_maintenance_corpus ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_corpus_select_published_authenticated
  ON public.jarvys_maintenance_corpus
  FOR SELECT
  TO authenticated
  USING (published = true AND reviewed_by_admin = true);

CREATE INDEX idx_corpus_brand_model
  ON public.jarvys_maintenance_corpus (brand, model_group);

CREATE INDEX idx_corpus_families_gin
  ON public.jarvys_maintenance_corpus USING GIN (mechanical_families_json);

CREATE INDEX idx_corpus_coverage_gin
  ON public.jarvys_maintenance_corpus USING GIN (coverage_json);

CREATE INDEX idx_corpus_published
  ON public.jarvys_maintenance_corpus (published)
  WHERE published;

CREATE TRIGGER trg_corpus_updated_at
  BEFORE UPDATE ON public.jarvys_maintenance_corpus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
