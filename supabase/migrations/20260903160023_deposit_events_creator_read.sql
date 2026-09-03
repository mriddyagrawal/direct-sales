-- Deposits redesign (owner 2026-09-03): the trail becomes first-class UI —
-- message ticks on every row, a timeline in the deposit detail. That needs
-- the CREATOR (salesman / godown / accountant recording their own) to read
-- the events of their own deposits; until now deposit_events was staff-only
-- and the salesman embed arrived RLS-empty. Staff policy unchanged; policies
-- OR together. Read-only — writes still go through RPCs + service role.

create policy deposit_events_select_creator on public.deposit_events
  for select to authenticated
  using (
    exists (
      select 1 from public.deposits d
      where d.id = deposit_events.deposit_id
        and d.salesman_id = (select auth.uid())
    )
  );
