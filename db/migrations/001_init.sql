-- 001_init.sql
-- Macro Oracle Radar (Supabase Postgres) — core schema + tables
-- Source of truth: /data/.openclaw/workspace/DATABASE_SCHEMA_SPEC.md

-- 1) schema + required extensions
create schema if not exists radar;

create extension if not exists pgcrypto; -- gen_random_uuid()
-- create extension if not exists pg_stat_statements; -- optional monitoring (enable in Supabase if allowed)
-- create extension if not exists pg_cron;            -- optional scheduling (enable in Supabase if allowed)
-- create extension if not exists btree_gin;          -- optional

-- 2) types / domains
-- Postgres does not support CREATE TYPE IF NOT EXISTS for enums in all versions,
-- so we use a duplicate_object exception guard for idempotency.
do $$
begin
  create type radar.ingestion_status as enum ('running','succeeded','failed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type radar.snapshot_timeframe as enum ('1h','4h','1d');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create domain radar.axis_score as double precision
    check (value is null or (value >= -10.0 and value <= 10.0));
exception
  when duplicate_object then null;
end $$;

-- 2.2 convenience trigger for updated_at
create or replace function radar.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 3) dimension / supporting tables
create table if not exists radar.axes (
  axis_id smallint primary key,
  axis_code text not null unique,
  axis_name text not null,
  description text,
  unit text default 'score',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint axes_axis_id_range check (axis_id between 1 and 8)
);

create index if not exists axes_active_idx on radar.axes (is_active) where is_active;

drop trigger if exists set_updated_at on radar.axes;
create trigger set_updated_at
before update on radar.axes
for each row execute function radar.tg_set_updated_at();


create table if not exists radar.api_sources (
  source_id bigserial primary key,
  source_name text not null unique,
  base_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on radar.api_sources;
create trigger set_updated_at
before update on radar.api_sources
for each row execute function radar.tg_set_updated_at();


create table if not exists radar.normalization_profiles (
  normalization_id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  params jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),

  unique (name, version)
);

create index if not exists normalization_active_idx
  on radar.normalization_profiles (is_active)
  where is_active;


create table if not exists radar.ingestion_runs (
  run_id uuid primary key default gen_random_uuid(),
  status radar.ingestion_status not null default 'running',

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  pipeline_version text not null,
  model_version text not null,
  normalization_id uuid references radar.normalization_profiles(normalization_id),

  input_fingerprint text,
  notes text,
  error jsonb,

  created_at timestamptz not null default now()
);

create index if not exists ingestion_runs_started_idx
  on radar.ingestion_runs (started_at desc);

create index if not exists ingestion_runs_status_idx
  on radar.ingestion_runs (status, started_at desc);


-- 4) partitioned facts
create table if not exists radar.snapshots (
  snapshot_id uuid not null default gen_random_uuid(),

  -- time
  as_of timestamptz not null,
  timeframe radar.snapshot_timeframe not null default '1h',

  -- reproducibility
  model_version text not null,
  run_id uuid references radar.ingestion_runs(run_id),
  normalization_id uuid references radar.normalization_profiles(normalization_id),

  -- the 8 risk axes (per requirement)
  axis_01 radar.axis_score not null,
  axis_02 radar.axis_score not null,
  axis_03 radar.axis_score not null,
  axis_04 radar.axis_score not null,
  axis_05 radar.axis_score not null,
  axis_06 radar.axis_score not null,
  axis_07 radar.axis_score not null,
  axis_08 radar.axis_score not null,

  -- optional convenience metrics
  overall_score radar.axis_score,
  confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- operational
  revision integer not null default 1,
  tags text[] not null default '{}',
  extra jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  primary key (snapshot_id, as_of)
)
partition by range (as_of);

-- Uniqueness per logical series (idempotency)
create unique index if not exists snapshots_series_uniq
  on radar.snapshots (as_of, timeframe, model_version, revision);

-- Fast latest-per-series
create index if not exists snapshots_latest_idx
  on radar.snapshots (timeframe, model_version, as_of desc);

-- Range scans
create index if not exists snapshots_asof_brin
  on radar.snapshots using brin (as_of);


create table if not exists radar.constituent_definitions (
  constituent_id uuid primary key default gen_random_uuid(),

  axis_id smallint not null references radar.axes(axis_id),

  code text not null,
  name text not null,
  description text,

  source_id bigint references radar.api_sources(source_id),
  source_series_id text,
  unit text,
  quote_ccy text,

  default_weight double precision not null default 1.0,

  normalization_hint jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (axis_id, code)
);

create index if not exists constituent_defs_axis_idx
  on radar.constituent_definitions (axis_id, is_active);

create index if not exists constituent_defs_source_idx
  on radar.constituent_definitions (source_id);

drop trigger if exists set_updated_at on radar.constituent_definitions;
create trigger set_updated_at
before update on radar.constituent_definitions
for each row execute function radar.tg_set_updated_at();


create table if not exists radar.constituents (
  as_of timestamptz not null,

  snapshot_id uuid not null,
  constituent_id uuid not null references radar.constituent_definitions(constituent_id),

  -- raw input
  raw_value double precision,
  raw_value_text text,

  -- normalized
  normalized_value double precision,

  -- weighting and contribution
  weight double precision,
  contribution double precision,

  -- provenance
  source_observed_at timestamptz,
  source_id bigint references radar.api_sources(source_id),
  source_payload jsonb,

  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint constituents_snapshot_fk
    foreign key (snapshot_id, as_of)
    references radar.snapshots (snapshot_id, as_of)
    on delete cascade,

  primary key (as_of, snapshot_id, constituent_id)
)
partition by range (as_of);

create index if not exists constituents_snapshot_idx
  on radar.constituents (snapshot_id);

create index if not exists constituents_constituent_time_idx
  on radar.constituents (constituent_id, as_of desc);

create index if not exists constituents_asof_brin
  on radar.constituents using brin (as_of);


-- 5) metadata/config
create table if not exists radar.metadata (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Optional: application-facing schema version singleton
create table if not exists radar.schema_version (
  id boolean primary key default true,
  version text not null,
  updated_at timestamptz not null default now(),
  constraint schema_version_singleton check (id = true)
);
