-- 0050: quote footer — Settings-managed fine print (exclusions, payment
-- terms) printed on quote PDFs under the validity line, mirroring
-- invoice_footer / claim_footer.
alter table settings add column quote_footer text;
