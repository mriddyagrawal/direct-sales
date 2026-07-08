-- Per-brand flag: show the model (tally_name) to the left of the display name
-- in Quick Order. Deliberately NOT tied to pricing_mode — both LG (manual) and
-- Luminous (fixed) have tally_name != name, so a "tally != name" rule would
-- wrongly light up Luminous. Owner wants explicit per-brand control: LG on,
-- everyone else off.
alter table brands add column show_model boolean not null default false;
update brands set show_model = true where code = 'LG';
