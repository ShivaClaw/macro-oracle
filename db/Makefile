SHELL := /bin/bash

PSQL ?= psql
DATABASE_URL ?=

MIGRATIONS := \
	migrations/001_init.sql \
	migrations/002_partitions.sql \
	migrations/003_rollups_views_retention.sql \
	migrations/004_seed.sql

.PHONY: migrate
migrate:
	@if [[ -z "$(DATABASE_URL)" ]]; then echo "DATABASE_URL is required"; exit 1; fi
	@for f in $(MIGRATIONS); do \
		echo ">>> Applying $$f"; \
		$(PSQL) "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -f $$f; \
	done

.PHONY: ensure-partitions
ensure-partitions:
	@if [[ -z "$(DATABASE_URL)" ]]; then echo "DATABASE_URL is required"; exit 1; fi
	$(PSQL) "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -c "select radar.ensure_monthly_partitions('radar.snapshots'::regclass, now()::date, 3);"
	$(PSQL) "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -c "select radar.ensure_monthly_partitions('radar.constituents'::regclass, now()::date, 3);"

.PHONY: rollup-daily
rollup-daily:
	@if [[ -z "$(DATABASE_URL)" ]]; then echo "DATABASE_URL is required"; exit 1; fi
	$(PSQL) "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -c "select radar.rollup_snapshots_daily(now()-interval '2 days', now(), '1h');"

.PHONY: rollup-weekly
rollup-weekly:
	@if [[ -z "$(DATABASE_URL)" ]]; then echo "DATABASE_URL is required"; exit 1; fi
	$(PSQL) "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -c "select radar.rollup_snapshots_weekly(current_date-21, current_date);"

.PHONY: purge-raw
purge-raw:
	@if [[ -z "$(DATABASE_URL)" ]]; then echo "DATABASE_URL is required"; exit 1; fi
	$(PSQL) "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -c "select * from radar.purge_raw_partitions(interval '30 days');"

.PHONY: purge-daily
purge-daily:
	@if [[ -z "$(DATABASE_URL)" ]]; then echo "DATABASE_URL is required"; exit 1; fi
	$(PSQL) "$(DATABASE_URL)" -v ON_ERROR_STOP=1 -c "select radar.purge_daily_rollups(interval '1 year');"
