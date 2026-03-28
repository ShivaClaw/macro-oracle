-- 003_rollups_views_retention.sql
-- Materialized views, rollup tables, and retention helpers

-- 1) Latest snapshots materialized view (read-optimized)
-- Use an existence check for compatibility across Postgres versions.
do $$
begin
  if not exists (
    select 1
    from pg_matviews
    where schemaname = 'radar'
      and matviewname = 'mv_latest_snapshots'
  ) then
    execute $mv$
      create materialized view radar.mv_latest_snapshots as
      select distinct on (timeframe, model_version)
        timeframe,
        model_version,
        snapshot_id,
        as_of,
        axis_01, axis_02, axis_03, axis_04, axis_05, axis_06, axis_07, axis_08,
        overall_score,
        confidence
      from radar.snapshots
      order by timeframe, model_version, as_of desc
    $mv$;
  end if;
end $$;

create unique index if not exists mv_latest_snapshots_uniq
  on radar.mv_latest_snapshots (timeframe, model_version);


-- 2) Rollup tables
create table if not exists radar.snapshots_daily (
  day date not null,
  timeframe radar.snapshot_timeframe not null default '1d',
  model_version text not null,

  axis_01 radar.axis_score not null,
  axis_02 radar.axis_score not null,
  axis_03 radar.axis_score not null,
  axis_04 radar.axis_score not null,
  axis_05 radar.axis_score not null,
  axis_06 radar.axis_score not null,
  axis_07 radar.axis_score not null,
  axis_08 radar.axis_score not null,
  overall_score radar.axis_score,

  computed_from_start timestamptz,
  computed_from_end   timestamptz,
  created_at timestamptz not null default now(),

  primary key (day, model_version)
);

create index if not exists snapshots_daily_day_idx
  on radar.snapshots_daily (day desc);


create table if not exists radar.snapshots_weekly (
  week_start date not null,
  model_version text not null,

  axis_01 radar.axis_score not null,
  axis_02 radar.axis_score not null,
  axis_03 radar.axis_score not null,
  axis_04 radar.axis_score not null,
  axis_05 radar.axis_score not null,
  axis_06 radar.axis_score not null,
  axis_07 radar.axis_score not null,
  axis_08 radar.axis_score not null,
  overall_score radar.axis_score,

  created_at timestamptz not null default now(),
  primary key (week_start, model_version)
);

create index if not exists snapshots_weekly_week_idx
  on radar.snapshots_weekly (week_start desc);


-- 3) Rollup routines
-- 3.1 Hourly -> Daily (canonical: last observation of each day)
create or replace function radar.rollup_snapshots_daily(
  p_from timestamptz default now() - interval '2 days',
  p_to   timestamptz default now(),
  p_source_timeframe radar.snapshot_timeframe default '1h'
)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  insert into radar.snapshots_daily (
    day, timeframe, model_version,
    axis_01, axis_02, axis_03, axis_04, axis_05, axis_06, axis_07, axis_08,
    overall_score,
    computed_from_start, computed_from_end
  )
  select
    date_trunc('day', s.as_of)::date as day,
    '1d'::radar.snapshot_timeframe as timeframe,
    s.model_version,
    (array_agg(axis_01 order by as_of desc))[1] as axis_01,
    (array_agg(axis_02 order by as_of desc))[1] as axis_02,
    (array_agg(axis_03 order by as_of desc))[1] as axis_03,
    (array_agg(axis_04 order by as_of desc))[1] as axis_04,
    (array_agg(axis_05 order by as_of desc))[1] as axis_05,
    (array_agg(axis_06 order by as_of desc))[1] as axis_06,
    (array_agg(axis_07 order by as_of desc))[1] as axis_07,
    (array_agg(axis_08 order by as_of desc))[1] as axis_08,
    (array_agg(overall_score order by as_of desc))[1] as overall_score,
    min(as_of) as computed_from_start,
    max(as_of) as computed_from_end
  from radar.snapshots s
  where s.timeframe = p_source_timeframe
    and s.as_of >= p_from
    and s.as_of <  p_to
  group by 1, 3
  on conflict (day, model_version)
  do update set
    timeframe = excluded.timeframe,
    axis_01 = excluded.axis_01,
    axis_02 = excluded.axis_02,
    axis_03 = excluded.axis_03,
    axis_04 = excluded.axis_04,
    axis_05 = excluded.axis_05,
    axis_06 = excluded.axis_06,
    axis_07 = excluded.axis_07,
    axis_08 = excluded.axis_08,
    overall_score = excluded.overall_score,
    computed_from_start = excluded.computed_from_start,
    computed_from_end = excluded.computed_from_end,
    created_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;


-- 3.2 Daily -> Weekly (canonical: last daily observation of each week)
create or replace function radar.rollup_snapshots_weekly(
  p_from date default (current_date - 14),
  p_to   date default current_date
)
returns bigint
language plpgsql
as $$
declare
  v_rows bigint;
begin
  insert into radar.snapshots_weekly (
    week_start,
    model_version,
    axis_01, axis_02, axis_03, axis_04, axis_05, axis_06, axis_07, axis_08,
    overall_score
  )
  select
    date_trunc('week', d.day)::date as week_start,
    d.model_version,
    (array_agg(d.axis_01 order by d.day desc))[1] as axis_01,
    (array_agg(d.axis_02 order by d.day desc))[1] as axis_02,
    (array_agg(d.axis_03 order by d.day desc))[1] as axis_03,
    (array_agg(d.axis_04 order by d.day desc))[1] as axis_04,
    (array_agg(d.axis_05 order by d.day desc))[1] as axis_05,
    (array_agg(d.axis_06 order by d.day desc))[1] as axis_06,
    (array_agg(d.axis_07 order by d.day desc))[1] as axis_07,
    (array_agg(d.axis_08 order by d.day desc))[1] as axis_08,
    (array_agg(d.overall_score order by d.day desc))[1] as overall_score
  from radar.snapshots_daily d
  where d.day >= p_from
    and d.day <  p_to
  group by 1, 2
  on conflict (week_start, model_version)
  do update set
    axis_01 = excluded.axis_01,
    axis_02 = excluded.axis_02,
    axis_03 = excluded.axis_03,
    axis_04 = excluded.axis_04,
    axis_05 = excluded.axis_05,
    axis_06 = excluded.axis_06,
    axis_07 = excluded.axis_07,
    axis_08 = excluded.axis_08,
    overall_score = excluded.overall_score,
    created_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;


-- 4) Retention helpers
-- 4.1 Drop fully-expired range partitions.
-- Only partitions whose END bound is <= cutoff are dropped.
create or replace function radar.drop_range_partitions_ending_before(
  p_parent regclass,
  p_cutoff timestamptz
)
returns int
language plpgsql
as $$
declare
  r record;
  v_end_text text;
  v_end timestamptz;
  v_dropped int := 0;
begin
  for r in
    select
      (n.nspname || '.' || c.relname) as child_fqn,
      pg_get_expr(c.relpartbound, c.oid, true) as bound_expr
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_namespace n on n.oid = c.relnamespace
    where i.inhparent = p_parent
  loop
    v_end_text := (regexp_match(r.bound_expr, $$TO \('([^']+)'\)$$))[1];
    if v_end_text is null then
      continue;
    end if;

    v_end := v_end_text::timestamptz;
    if v_end <= p_cutoff then
      execute format('drop table if exists %s', r.child_fqn);
      v_dropped := v_dropped + 1;
    end if;
  end loop;

  return v_dropped;
end;
$$;

-- 4.2 Apply the raw retention policy (recommended: drop constituents partitions first)
create or replace function radar.purge_raw_partitions(
  p_keep interval default interval '30 days'
)
returns table (
  dropped_constituent_partitions int,
  dropped_snapshot_partitions int
)
language plpgsql
as $$
declare
  v_cutoff timestamptz := now() - p_keep;
begin
  dropped_constituent_partitions := radar.drop_range_partitions_ending_before('radar.constituents'::regclass, v_cutoff);
  dropped_snapshot_partitions    := radar.drop_range_partitions_ending_before('radar.snapshots'::regclass, v_cutoff);
  return next;
end;
$$;

-- 4.3 Purge daily rollups beyond 1 year (after weekly rollups exist)
create or replace function radar.purge_daily_rollups(
  p_keep interval default interval '1 year'
)
returns int
language plpgsql
as $$
declare
  v_cutoff date := (current_date - p_keep)::date;
  v_rows int;
begin
  delete from radar.snapshots_daily
  where day < v_cutoff;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;


-- 5) Minimal chart view (90d hourly)
create or replace view radar.v_snapshots_chart_90d as
select
  as_of,
  model_version,
  axis_01, axis_02, axis_03, axis_04, axis_05, axis_06, axis_07, axis_08,
  overall_score
from radar.snapshots
where timeframe='1h'
  and as_of >= now() - interval '90 days';
