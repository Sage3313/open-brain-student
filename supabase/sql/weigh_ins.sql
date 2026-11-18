-- Daily weigh-ins. One per Arizona calendar day (a second entry that day replaces the first).
create table if not exists weigh_ins (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  lbs        numeric(5,1) not null check (lbs between 50 and 600),
  source     text not null default 'telegram',
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
alter table weigh_ins enable row level security;
drop policy if exists "own_weigh_ins" on weigh_ins;
create policy "own_weigh_ins" on weigh_ins for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
