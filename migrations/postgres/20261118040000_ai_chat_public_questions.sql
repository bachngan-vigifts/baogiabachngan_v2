CREATE TABLE IF NOT EXISTS ai_chat_questions (
  id text PRIMARY KEY,
  question text NOT NULL,
  answer text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT 'CRM',
  status text NOT NULL DEFAULT 'pending',
  created_by text NOT NULL REFERENCES staff_members(id),
  callback_token_hash text,
  error text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  answered_at text,
  updated_at text NOT NULL,
  CONSTRAINT chk_ai_chat_questions_status CHECK (status IN ('pending','answered','needs_review','failed'))
);
ALTER TABLE ai_chat_questions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ai_chat_questions_public ON ai_chat_questions(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_chat_questions_status ON ai_chat_questions(status, updated_at);

CREATE TABLE IF NOT EXISTS ai_chat_helpful_votes (
  question_id text NOT NULL REFERENCES ai_chat_questions(id),
  member_id text NOT NULL REFERENCES staff_members(id),
  created_at text NOT NULL,
  PRIMARY KEY (question_id, member_id)
);
ALTER TABLE ai_chat_helpful_votes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ai_chat_helpful_member ON ai_chat_helpful_votes(member_id);
