-- Supabase schema SKETCH for the future remote DataSource (src/data.ts). Not required to run the app.
-- Auth idea: Supabase anonymous sign-in for everyone (auth.uid()); boss = team owner, worker = team member.

create table teams (
  code text primary key check (code ~ '^[0-9]{6}$'),
  name text not null,
  break_minutes int not null default 30,   -- deducted when a shift is > 5h
  owner uuid not null default auth.uid() references auth.users(id)
);

create table workers (
  id uuid primary key default gen_random_uuid(),
  team_code text not null references teams(code) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  unique (team_code, name)
);

create table punches (
  id uuid primary key,                      -- generated on the phone so offline retries are idempotent
  team_code text not null references teams(code) on delete cascade,
  worker_id uuid not null references workers(id) on delete cascade,
  type text not null check (type in ('in','out')),
  ts timestamptz not null,                  -- time on the phone when tapped
  lat double precision,
  lng double precision,
  photo_path text,                          -- path in Storage bucket 'punch-photos'
  created_at timestamptz not null default now()
);
create index on punches (team_code, ts);

alter table teams   enable row level security;
alter table workers enable row level security;
alter table punches enable row level security;

-- helper: is the caller the boss of / a worker in this team?
create function is_boss(c text) returns boolean language sql stable security definer as
  $$ select exists (select 1 from teams where code = c and owner = auth.uid()) $$;
create function is_member(c text) returns boolean language sql stable security definer as
  $$ select exists (select 1 from workers where team_code = c and user_id = auth.uid()) $$;

-- teams: boss manages own team; members can read it. Joining by code goes through an RPC
-- (security definer function that checks the code and inserts into workers), not a direct read.
create policy teams_boss   on teams for all using (owner = auth.uid()) with check (owner = auth.uid());
create policy teams_member on teams for select using (is_member(code));

-- workers: boss sees all in team; a worker sees/creates only themselves
create policy workers_boss on workers for select using (is_boss(team_code));
create policy workers_self on workers for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- punches: boss reads the team's punches; a worker reads/inserts only their own
create policy punches_boss on punches for select using (is_boss(team_code));
create policy punches_self_read   on punches for select using (worker_id in (select id from workers where user_id = auth.uid()));
create policy punches_self_insert on punches for insert
  with check (worker_id in (select id from workers where user_id = auth.uid()) and is_member(team_code));

-- Storage: bucket 'punch-photos', path '<team_code>/<worker_id>/<punch_id>.jpg';
-- insert allowed for members of the team, select for the team's boss (policies on storage.objects).
