-- Builder feedback posts to the scorecard immediately. No approval step.
-- Managers can still remove a post from the Builder Feedback page
-- (sets is_approved = false and records reviewed_by / reviewed_at / review_notes).
-- Existing pending rows are not changed. They stay in the Pending tab.

ALTER TABLE public.builder_feedback ALTER COLUMN is_approved SET DEFAULT true;
