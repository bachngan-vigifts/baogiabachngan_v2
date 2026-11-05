-- Góp ý phát triển phần mềm (nhân viên gửi, người có quyền "Quản lý góp ý" xử lý). Bảng mới, không đụng dữ liệu cũ. Chạy tay trước khi triển khai API.
CREATE TABLE IF NOT EXISTS public.software_feedback (
 id text PRIMARY KEY,
 ticket_no bigint NOT NULL CONSTRAINT chk_software_feedback_ticket CHECK (ticket_no > 0),
 kind text NOT NULL CONSTRAINT chk_software_feedback_kind CHECK (kind IN ('bug','feature','ui','other')),
 impact text NOT NULL CONSTRAINT chk_software_feedback_impact CHECK (impact IN ('low','medium','high','blocking')),
 title text NOT NULL, description text NOT NULL, steps text NOT NULL DEFAULT '',
 page_url text NOT NULL DEFAULT '', client_info text NOT NULL DEFAULT '',
 visibility text NOT NULL DEFAULT 'public' CONSTRAINT chk_software_feedback_visibility CHECK (visibility IN ('public','private')),
 status text NOT NULL DEFAULT 'new' CONSTRAINT chk_software_feedback_status CHECK (status IN ('new','reviewing','planned','in_progress','done','wont_do','duplicate')),
 priority text CONSTRAINT chk_software_feedback_priority CHECK (priority IS NULL OR priority IN ('low','medium','high','urgent')),
 duplicate_of text,
 created_by text NOT NULL REFERENCES public.staff_members(id),
 client_key text NOT NULL, payload_hash text NOT NULL,
 created_at text NOT NULL, updated_at text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_software_feedback_ticket ON public.software_feedback(ticket_no);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_software_feedback_client_key ON public.software_feedback(created_by, client_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_software_feedback_status ON public.software_feedback(status, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_software_feedback_creator ON public.software_feedback(created_by, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.software_feedback_photos (
 id text PRIMARY KEY, feedback_id text NOT NULL REFERENCES public.software_feedback(id),
 file_key text NOT NULL, bytes bigint NOT NULL, created_by text NOT NULL REFERENCES public.staff_members(id), created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_software_feedback_photos ON public.software_feedback_photos(feedback_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.software_feedback_votes (
 feedback_id text NOT NULL REFERENCES public.software_feedback(id), member_id text NOT NULL REFERENCES public.staff_members(id), created_at text NOT NULL,
 PRIMARY KEY (feedback_id, member_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_software_feedback_votes_member ON public.software_feedback_votes(member_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.software_feedback_comments (
 id text PRIMARY KEY, feedback_id text NOT NULL REFERENCES public.software_feedback(id), author_id text NOT NULL REFERENCES public.staff_members(id),
 kind text NOT NULL DEFAULT 'comment' CONSTRAINT chk_software_feedback_comment_kind CHECK (kind IN ('comment','status')),
 body text NOT NULL, created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_software_feedback_comments ON public.software_feedback_comments(feedback_id, created_at);
--> statement-breakpoint
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['software_feedback','software_feedback_photos','software_feedback_votes','software_feedback_comments'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', tbl);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', tbl); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role', tbl); END IF;
 END LOOP;
END $$;
