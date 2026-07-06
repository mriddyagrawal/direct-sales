-- M1.4: triggers — touch_updated_at attachment, recompute_order_total, guard_order_transition
-- Source of truth: docs/specs/data-model.md ("Triggers" table)

create trigger touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

create trigger touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- orders.total_paise is a cache; the items table is the source of truth.
create or replace function public.recompute_order_total()
returns trigger
language plpgsql
as $$
declare
  v_order_id uuid;
begin
  v_order_id := coalesce(new.order_id, old.order_id);

  update public.orders
     set total_paise = (
       select coalesce(sum(line_total_paise), 0)
       from public.order_items
       where order_id = v_order_id
     )
   where id = v_order_id;

  return null;
end;
$$;

create trigger recompute_order_total
  after insert or update or delete on public.order_items
  for each row execute function public.recompute_order_total();

-- Defense in depth behind the RPCs: reject any status jump that isn't one of the
-- lifecycle's legal edges, regardless of caller. Non-status updates (e.g. the
-- total_paise write above, or notes/processed_at/cancelled_at changes that don't
-- touch status) are always allowed through — only a *changing* status is checked.
create or replace function public.guard_order_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'submitted' and new.status in ('processed', 'cancelled') then
    return new;
  end if;

  if old.status = 'processed' and new.status = 'cancelled' then
    return new;
  end if;

  raise exception 'illegal order status transition: % -> % (order %)', old.status, new.status, old.id;
end;
$$;

create trigger guard_order_transition
  before update on public.orders
  for each row execute function public.guard_order_transition();
