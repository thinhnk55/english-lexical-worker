-- Authoring-only visual continuity brief. It is intentionally stored on the
-- passage itself: it has no independent lifecycle or learner-runtime use.
ALTER TABLE passages ADD COLUMN visual_bible TEXT;
