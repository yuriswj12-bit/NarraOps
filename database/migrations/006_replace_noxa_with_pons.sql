UPDATE launch_drafts SET platform_id = 'pons' WHERE platform_id = 'noxa';

ALTER TABLE launch_drafts DROP CONSTRAINT IF EXISTS launch_drafts_platform_id_check;
ALTER TABLE launch_drafts
  ADD CONSTRAINT launch_drafts_platform_id_check
  CHECK (platform_id IN ('pump', 'fourmeme', 'pons'));
