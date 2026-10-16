-- ECR IMS Rev 1 document control (SMS-02, IMS-R-05): every controlled
-- document carries two dates — first issued (the date it first entered use)
-- and the issue date of its current revision (documents.issued_at). Both are
-- read from IMS-R-05, never generated.
alter table documents
  add column first_issued date;

comment on column documents.first_issued is
  'Date the document first entered use, per IMS-R-05. issued_at holds the current revision''s issue date.';
