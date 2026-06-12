-- 0011_attachment_parents.sql
-- Extend attachments.parent_type to cover WHS parents: incidents and
-- (immutable) form submissions get their photos via the attachments table
-- rather than inside the jsonb data payload.

alter table attachments drop constraint attachments_parent_type_check;
alter table attachments add constraint attachments_parent_type_check
  check (parent_type in (
    'job','project','quote','invoice','claim','po','vendor','diary',
    'variation','package','incident','form_submission'
  ));
