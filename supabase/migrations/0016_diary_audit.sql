-- 0016_diary_audit.sql
-- Site diaries are contemporaneous ISO/legal records: every create AND edit must
-- be attributable and traceable. The diaries / diary_labour / diary_plant tables
-- carried no audit trigger, so saveProjectDiary/saveDiary could overwrite text
-- with no trace. This attaches the existing audit_whs() AFTER INSERT/UPDATE/DELETE
-- trigger (from 0010_whs.sql) to all three tables — same pattern as every other
-- audited table — writing who/when/what into the append-only audit_log.
--
-- No table columns or save-action behaviour change; the trigger is the fix.

create trigger diaries_audit
  after insert or update or delete on public.diaries
  for each row execute function audit_whs();

create trigger diary_labour_audit
  after insert or update or delete on public.diary_labour
  for each row execute function audit_whs();

create trigger diary_plant_audit
  after insert or update or delete on public.diary_plant
  for each row execute function audit_whs();
