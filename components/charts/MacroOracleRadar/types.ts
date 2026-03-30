export type FlowDirection = 'inflow' | 'outflow' | 'neutral';

export type RiskBandPoint = {
  key: string;
  label: string;
  name?: string;
  valueNow: number;
  value7dAgo?: number;
  delta7d?: number;
  flowDirection?: FlowDirection;
};

export type MacroOracleMode = 'g' | 'p';

export type MacroOracleRadarPayload = {
  asOf: string;
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
