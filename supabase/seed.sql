-- Seed Valerie with a demo poll so the home page has something to render immediately.
INSERT INTO valerie.polls (question_text, is_active)
VALUES ('The city should convert Main Street into a pedestrian-only zone.', true)
ON CONFLICT DO NOTHING;
