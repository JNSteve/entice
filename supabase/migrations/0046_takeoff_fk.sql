-- 0046: takeoff provenance FK — on delete set null.
-- 0045 created quote_lines.takeoff_item_id with the default NO ACTION, which
-- blocks deleting any takeoff item that has been pushed to the quote. The
-- intended semantics: the quote line keeps its data and simply loses the
-- provenance link (mirrors takeoff_items.sheet_id on delete set null).

alter table quote_lines
  drop constraint quote_lines_takeoff_item_id_fkey;

alter table quote_lines
  add constraint quote_lines_takeoff_item_id_fkey
  foreign key (takeoff_item_id) references takeoff_items(id) on delete set null;
