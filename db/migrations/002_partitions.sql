-- 002_partitions.sql
-- Declarative partition helpers + initial monthly partitions

-- Helper: create monthly partitions for a range-partitioned parent table in radar schema
create or replace function radar.ensure_monthly_partitions(
  p_parent regclass,
  p_from date,
  p_months_ahead int default 2
)
returns void
language plpgsql
as $$
declare
  d date;
  start_ts timestamptz;
  end_ts timestamptz;
  part_name text;
  parent_name text := replace(p_parent::text, 'radar.', '');
begin
  d := date_trunc('month', p_from)::date;

  for i in 0..p_months_ahead loop
    start_ts := (d + (i || ' months')::interval)::timestamptz;
    end_ts   := (d + ((i+1) || ' months')::interval)::timestamptz;

    part_name := format('radar.%s_%s', parent_name, to_char(start_ts, 'YYYY_MM'));

    execute format(
      'create table if not exists %s partition of %s for values from (%L) to (%L)',
      part_name, p_parent, start_ts, end_ts
    );
  end loop;
end;
$$;

-- Create initial partitions: current month + next 2 months
-- (idempotent; safe to re-run)
do $$
begin
  perform radar.ensure_monthly_partitions('radar.snapshots'::regclass, now()::date, 2);
  perform radar.ensure_monthly_partitions('radar.constituents'::regclass, now()::date, 2);
end;
$$;

-- If pg_cron is available, you can schedule daily partition maintenance:
-- select cron.schedule('radar_partition_maintenance', '15 0 * * *',
--   $$select radar.ensure_monthly_partitions('radar.snapshots'::regclass, now()::date, 3);
--     select radar.ensure_monthly_partitions('radar.constituents'::regclass, now()::date, 3);$$
-- );
