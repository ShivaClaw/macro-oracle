import type { EChartsOption } from 'echarts';
import type { MacroOracleRadarPayload } from './types';
import { clamp } from './radarMath';

export type RadarLabelMode = 'compact' | 'full';

export type BuildOptionParams = {
  theme: 'dark' | 'light';
  radius: string | number;
  labelMode: RadarLabelMode;
  showGhostPrev?: boolean;
};

function axisLabelForBand(
  band: { label: string; name?: string },
  labelMode: RadarLabelMode
): string {
  const primary = band.label;
  const secondary = band.name ?? '';
  if (labelMode === 'compact' || !secondary) return primary;
  return `${primary}\n${secondary}`.trim();
}

export function buildRadarOption(
  payload: MacroOracleRadarPayload,
  params: BuildOptionParams
): EChartsOption {
  const { theme, radius, labelMode, showGhostPrev } = params;
  const isDark = theme === 'dark';

  const vNow = payload.bands.map((b) => clamp(b.valueNow, 0, 100));

  const gridLine = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
  const axisNameColor = isDark ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.70)';
  const polyStroke = isDark ? '#78FBE6' : '#0D2E58';
  const polyGlow = isDark ? 'rgba(120,251,230,0.45)' : 'rgba(13,46,88,0.40)';
  const polyFill = isDark ? 'rgba(120,251,230,0.12)' : 'rgba(7,35,73,0.08)';

  const seriesData: any[] = [];

  if (showGhostPrev) {
    // If backend supplies value7dAgo consistently, ghost polygon helps.
    const hasAllPrev = payload.bands.every((b) => typeof b.value7dAgo === 'number');
    if (hasAllPrev) {
      const vPrev = payload.bands.map((b) => clamp(b.value7dAgo ?? b.valueNow, 0, 100));
      seriesData.push({
        value: vPrev,
        areaStyle: { color: 'transparent' },
        lineStyle: {
          width: 1,
          type: 'dashed',
          opacity: 0.55,
          color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)'
        },
        symbol: 'none'
      });
    }
  }

  seriesData.push({
    value: vNow,
    areaStyle: { color: polyFill },
    lineStyle: {
      width: 3,
      color: polyStroke,
      shadowBlur: isDark ? 18 : 10,
      shadowColor: polyGlow
    },
    symbol: 'none'
  });

  const option: EChartsOption = {
    backgroundColor: 'transparent',
    animation: true,
    animationDurationUpdate: 550,
    animationEasingUpdate: 'cubicOut',
    tooltip: { show: false },
    legend: { show: false },
    radar: {
      center: ['50%', '52%'],
      radius,
      startAngle: 90,
      splitNumber: 5,
      shape: 'polygon',
      axisName: {
        color: axisNameColor,
        fontSize: 11,
        overflow: 'truncate'
      },
      axisLine: { lineStyle: { color: gridLine } },
      splitLine: { lineStyle: { color: gridLine } },
      splitArea: {
        areaStyle: {
          color: isDark
            ? ['rgba(255,255,255,0.02)', 'rgba(255,255,255,0.00)']
            : ['rgba(0,0,0,0.02)', 'rgba(0,0,0,0.00)']
        }
      },
      indicator: payload.bands.map((b) => ({
        name: axisLabelForBand(b, labelMode),
        max: 100
      }))
    },
    series: [
      {
        name: 'Allocation',
        type: 'radar',
        silent: true,
        emphasis: { disabled: true },
        data: seriesData
      }
    ]
  };

  return option;
}
