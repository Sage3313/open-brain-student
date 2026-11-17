-- Reminders that the Telegram bot texts to Sage at the right time.
create table if not exists reminders (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  text       text not null,
  remind_at  timestamptz not null,
  sent_at    timestamptz,
  cancelled  boolean not null default false,
  source     text not null default 'telegram',
  created_at timestamptz not null default now()
);
create index if not exists reminders_due on reminders (remind_at) where sent_at is null and not cancelled;
alter table reminders enable row level security;
drop policy if exists "own_reminders" on reminders;
create policy "own_reminders" on reminders for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Proof that scheduled jobs ran (heartbeats for jobs that live in the cloud).
create table if not exists job_runs (
  job        text primary key,
  last_run   timestamptz not null,
  status     text not null,
  detail     text
);
alter table job_runs enable row level security;  -- no policies: server-only
