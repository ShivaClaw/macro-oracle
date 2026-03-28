import { describe, expect, it } from 'vitest';
import { buildRadarOption } from '../option';
import type { MacroOracleRadarPayload } from '../types';

describe('option', () => {
  it('buildRadarOption is non-interactive and respects band ordering', () => {
    const payload: MacroOracleRadarPayload = {
      asOf: '2026-03-28T00:00:00Z',
      bands: [
        { key: 'R0', label: 'RISK 0', valueNow: 10 },
        { key: 'R1', label: 'RISK 1', valueNow: 20 }
      ]
    };

    const opt: any = buildRadarOption(payload, {
      theme: 'dark',
      radius: '70%',
      labelMode: 'compact'
    });

    expect(opt.tooltip?.show).toBe(false);
    expect(opt.legend?.show).toBe(false);
    expect(opt.series?.[0]?.silent).toBe(true);
    expect(opt.radar?.indicator?.[0]?.name).toContain('RISK 0');
    expect(opt.radar?.indicator?.[1]?.name).toContain('RISK 1');
  });
});
