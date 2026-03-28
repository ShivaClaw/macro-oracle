-- 004_seed.sql
-- Seed canonical axes + baseline metadata keys

insert into radar.axes (axis_id, axis_code, axis_name, description)
values
  (1, 'axis_01', 'Axis 01', 'Risk axis 1'),
  (2, 'axis_02', 'Axis 02', 'Risk axis 2'),
  (3, 'axis_03', 'Axis 03', 'Risk axis 3'),
  (4, 'axis_04', 'Axis 04', 'Risk axis 4'),
  (5, 'axis_05', 'Axis 05', 'Risk axis 5'),
  (6, 'axis_06', 'Axis 06', 'Risk axis 6'),
  (7, 'axis_07', 'Axis 07', 'Risk axis 7'),
  (8, 'axis_08', 'Axis 08', 'Risk axis 8')
on conflict (axis_id) do nothing;

-- Baseline metadata examples (adjust as your app matures)
insert into radar.metadata (key, value, updated_by)
values
  (
    'radar.active',
    jsonb_build_object(
      'model_version', 'v1',
      'timeframe', '1h',
      'revision', 1
    ),
    'migration'
  ),
  (
    'radar.retention_policy',
    jsonb_build_object(
      'raw_hourly_keep', '30 days',
      'daily_keep', '1 year',
      'weekly_keep', 'forever',
      'notes', 'Raw snapshots+constituents kept in monthly partitions; daily/weekly rollups in non-partitioned tables.'
    ),
    'migration'
  )
on conflict (key) do update
set value = excluded.value,
    updated_at = now(),
    updated_by = excluded.updated_by;

-- Optional: set an application-visible schema version (update as you evolve)
insert into radar.schema_version (id, version)
values (true, '001')
on conflict (id) do update
set version = excluded.version,
    updated_at = now();
