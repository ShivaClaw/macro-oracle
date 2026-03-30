export type FlowDirection = 'inflow' | 'outflow' | 'neutral';

export type MacroOracleMode = 'g' | 'p';

export type RiskBandPoint = {
  key: string; // 'R0'...'R8'
  label: string; // 'RISK 0'
  name?: string; // 'Cash / T-Bills'
  valueNow: number; // 0..100
  value7dAgo?: number; // 0..100
  delta7d?: number; // optional
  flowDirection?: FlowDirection;
};

export type MacroOracleRadarPayload = {
  asOf: string; // ISO
  mode?: MacroOracleMode;
  bands: RiskBandPoint[];
  history?: {
    cadence: '1d' | '1h' | string;
    windowDays: number;
    points: Array<{ t: string; values: Record<string, number> }>;
  };
  meta?: Record<string, unknown>;
};

export type MacroOracleRadarProps = {
  payload: MacroOracleRadarPayload;
  mode?: MacroOracleMode;
  theme: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
  showBadges?: boolean;
};
