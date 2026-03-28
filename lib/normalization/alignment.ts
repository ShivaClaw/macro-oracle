import type { Interpolation, Observation } from './types';
import { dayNumberToIso, toDayNumber, isoToDayNumber } from './dates';

export interface DailyAlignedPoint {
  day: number;
  date: string;

  /** last obs day at or before t */
  asof_day: number | null;
  asof_date: string | null;

  /** raw value at asof_day */
  value_raw_asof: number | null;

  /** daily-aligned y(t) after interpolation */
  value_daily: number | null;

  flags: {
    stale: boolean;
    missing: boolean;
    reason?: string;
  };
}

function preprocessObservations(observations: Observation[]): { days: number[]; values: number[] } {
  // Normalize to day-number, keep last value per day (if multiple observations within a day).
  const byDay = new Map<number, number>();
  const dayList: number[] = [];
  for (const o of observations) {
    const d = toDayNumber(o.timestamp);
    if (!byDay.has(d)) dayList.push(d);
    byDay.set(d, o.value);
  }
  dayList.sort((a, b) => a - b);
  const values = dayList.map((d) => byDay.get(d)!);
  return { days: dayList, values };
}

export function alignToDailyGrid(params: {
  observations: Observation[];
  evaluationDates: string[];
  interpolation: Interpolation;
  staleDays: number;
}): DailyAlignedPoint[] {
  const { observations, evaluationDates, interpolation, staleDays } = params;
  const { days: obsDays, values: obsVals } = preprocessObservations(observations);

  const out: DailyAlignedPoint[] = [];
  let idx = -1; // last obs index where obsDays[idx] <= day

  for (const iso of evaluationDates) {
    const day = isoToDayNumber(iso);

    while (idx + 1 < obsDays.length && obsDays[idx + 1]! <= day) idx++;

    const prevDay = idx >= 0 ? obsDays[idx]! : null;
    const prevVal = idx >= 0 ? obsVals[idx]! : null;

    const nextDay = idx + 1 < obsDays.length ? obsDays[idx + 1]! : null;
    const nextVal = idx + 1 < obsDays.length ? obsVals[idx + 1]! : null;

    const stale = prevDay === null ? false : day - prevDay > staleDays;

    let valueDaily: number | null = null;
    let missing = false;
    let reason: string | undefined;

    if (prevDay === null) {
      missing = true;
      reason = 'no_data';
    } else if (stale) {
      missing = true;
      reason = 'stale';
    } else if (interpolation === 'none') {
      if (day === prevDay) valueDaily = prevVal;
      else {
        missing = true;
        reason = 'not_observation_day';
      }
    } else if (interpolation === 'ffill') {
      valueDaily = prevVal;
    } else {
      // linear
      if (day === prevDay) valueDaily = prevVal;
      else if (nextDay !== null && nextVal !== null && prevDay < day && day < nextDay) {
        const w = (day - prevDay) / (nextDay - prevDay);
        valueDaily = prevVal! + w * (nextVal - prevVal!);
      } else {
        // no next obs; fall back to ffill
        valueDaily = prevVal;
      }
    }

    out.push({
      day,
      date: iso,
      asof_day: prevDay,
      asof_date: prevDay === null ? null : dayNumberToIso(prevDay),
      value_raw_asof: prevVal,
      value_daily: missing ? null : valueDaily,
      flags: { stale, missing, reason }
    });
  }

  return out;
}

export function lastObservationAtOrBefore(observations: Observation[], dateIso: string): { asof_date: string | null; value: number | null } {
  const day = isoToDayNumber(dateIso);
  const { days, values } = preprocessObservations(observations);
  let idx = -1;
  while (idx + 1 < days.length && days[idx + 1]! <= day) idx++;
  if (idx < 0) return { asof_date: null, value: null };
  return { asof_date: dayNumberToIso(days[idx]!), value: values[idx]! };
}
