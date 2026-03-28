import { describe, expect, it } from 'vitest';
import { flowAlpha, tailEncoding } from '../overlays';

describe('overlays encoding', () => {
  it('flowAlpha stays within defined window', () => {
    expect(flowAlpha(0)).toBeCloseTo(0.08, 6);
    expect(flowAlpha(1)).toBeCloseTo(0.42, 6);
    expect(flowAlpha(2)).toBeCloseTo(0.42, 6);
  });

  it('tailEncoding clamps width and alpha', () => {
    expect(tailEncoding(0).width).toBeGreaterThanOrEqual(1.5);
    expect(tailEncoding(500).width).toBeLessThanOrEqual(6);

    expect(tailEncoding(0).alphaEnd).toBeCloseTo(0.35, 6);
    expect(tailEncoding(500).alphaEnd).toBeLessThanOrEqual(0.85);
  });
});
