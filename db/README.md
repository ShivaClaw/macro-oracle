# Macro Oracle Radar — DB

Production SQL migrations for the **Macro Oracle Radar** schema (Supabase Postgres / vanilla Postgres).

Source spec: `../../DATABASE_SCHEMA_SPEC.md`.

## Layout

- `migrations/001_init.sql` — schema, extensions, enums/domains, core + supporting tables
- `migrations/002_partitions.sql` — monthly partition helper + initial partitions (current month + next 2)
- `migrations/003_rollups_views_retention.sql` — rollup tables, materialized view, retention helpers
- `migrations/004_seed.sql` — seed 8 axes + sample metadata (+ schema_version)

## Apply migrations (psql)

### Option A) Using `DATABASE_URL`

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/postgres'

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_init.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/002_partitions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/003_rollups_views_retention.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/004_seed.sql
```

### Option B) Supabase

- In Supabase SQL Editor: paste/run migrations **in order**.
- Or use Supabase CLI migrations if your repo is set up for it (these files are plain SQL).

Notes:
- `pgcrypto` is required for `gen_random_uuid()`.
- `pg_cron` / `pg_stat_statements` are **optional** and are not enabled by these migrations.

## Partition maintenance

Tables partitioned monthly by `as_of`:
- `radar.snapshots`
- `radar.constituents`

Create partitions ahead of time (e.g. on deploy or nightly):

```sql
select radar.ensure_monthly_partitions('radar.snapshots'::regclass, now()::date, 3);
select radar.ensure_monthly_partitions('radar.constituents'::regclass, now()::date, 3);
```

## Rollups (downsampling)

### Hourly → Daily

Canonical rule: **last observation of the day** per `model_version`.

```sql
select radar.rollup_snapshots_daily(
  now() - interval '2 days',
  now(),
  '1h'
);
```

### Daily → Weekly

Canonical rule: **last daily observation of the week** per `model_version`.

```sql
select radar.rollup_snapshots_weekly(
  current_date - 21,
  current_date
);
```

## Retention policy operations

Policy from spec:
- **0–30 days:** keep raw hourly `radar.snapshots` + `radar.constituents` (partitioned)
- **30 days–1 year:** keep `radar.snapshots_daily`
- **>1 year:** keep `radar.snapshots_weekly`

### Purge raw partitions (drop whole monthly partitions when fully out of window)

This only drops partitions whose **END bound** is older than the cutoff.

```sql
select * from radar.purge_raw_partitions(interval '30 days');
```

### Purge daily rollups beyond 1 year

```sql
select radar.purge_daily_rollups(interval '1 year');
```

## Materialized view refresh

Latest snapshots MV:

```sql
refresh materialized view concurrently radar.mv_latest_snapshots;
```

Refresh after ingestion completes, or on a schedule.

## Seeding

- Axes are seeded in `004_seed.sql` (8 rows with `axis_id` 1..8).
- `radar.metadata` is seeded with example keys:
  - `radar.active`
  - `radar.retention_policy`

Re-running seed is safe (UPSERTs / `on conflict`).
