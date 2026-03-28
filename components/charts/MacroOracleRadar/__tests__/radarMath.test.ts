import { describe, expect, it } from 'vitest';
import { axisAngleDeg, pointForValue, type RadarGeometry } from '../radarMath';

describe('radarMath', () => {
  it('axisAngleDeg steps clockwise from startAngle', () => {
    const geom: RadarGeometry = { cx: 0, cy: 0, r: 100, startAngleDeg: 90, n: 4 };
    expect(axisAngleDeg(0, geom)).toBe(90);
    expect(axisAngleDeg(1, geom)).toBe(0);
    expect(axisAngleDeg(2, geom)).toBe(-90);
    expect(axisAngleDeg(3, geom)).toBe(-180);
  });

  it('pointForValue uses y-down canvas convention', () => {
    const geom: RadarGeometry = { cx: 10, cy: 10, r: 100, startAngleDeg: 90, n: 4 };

    // i=0 at top: y should decrease.
    const pTop = pointForValue(0, 100, geom);
    expect(Math.round(pTop.x)).toBe(10);
    expect(Math.round(pTop.y)).toBe(-90);

    // i=1 at right: x should increase.
    const pRight = pointForValue(1, 100, geom);
    expect(Math.round(pRight.x)).toBe(110);
    expect(Math.round(pRight.y)).toBe(10);
  });
});
