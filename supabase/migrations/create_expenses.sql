-- Proyecto: jogegcoesopmgluhxojt (gastos-app)
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  description text not null,
  motivo text not null check (motivo in ('materiales', 'mano_de_obra', 'pago', 'recoleccion')),
  amount_ars numeric(14, 2) not null check (amount_ars > 0),
  usd_rate numeric(14, 4),
  rate_status text not null default 'pending' check (rate_status in ('pending', 'ok', 'error')),
  created_at timestamptz not null default now()
);

create index expenses_date_idx on public.expenses (date desc);

alter table public.expenses enable row level security;

create policy "expenses_select" on public.expenses
  for select to anon, authenticated using (true);

create policy "expenses_insert" on public.expenses
  for insert to anon, authenticated with check (true);

create policy "expenses_update" on public.expenses
  for update to anon, authenticated using (true) with check (true);

create policy "expenses_delete" on public.expenses
  for delete to anon, authenticated using (true);

grant select, insert, update, delete on table public.expenses to anon, authenticated;
