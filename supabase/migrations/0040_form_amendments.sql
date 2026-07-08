-- Corrections without mutation: a submission may declare it AMENDS an earlier
-- one. Both rows stay immutable (no UPDATE policy exists on form_submissions);
-- the chain is the audit trail.
alter table form_submissions
  add column amends uuid references form_submissions(id);
create index form_submissions_amends_idx
  on form_submissions (amends) where amends is not null;
