import type { ProviderName } from '@/lib/providers/types'

export type TransformKind = 'level' | 'pct_change' | 'yoy' | 'spread'
export type NormalizeKind = 'zscore' | 'minmax'

export type ConstituentDef = {
  id: string
  label: string
  unit: string
  provider: ProviderName
  endpointTemplate: string
  params: Record<string, string | number>
  ttlSeconds: number
  staleMaxAgeSeconds: number
  weight: number
  polarity: 'risk_on' | 'risk_off'
  frequency: 'daily' | 'weekly' | 'monthly'
  transform: {
    kind: TransformKind
    windowDays?: number
  }
  normalize: {
    kind: NormalizeKind
    lookbackDays: number
    clamp?: { min: number; max: number }
  }
  fallback?: {
    provider: ProviderName
    endpointTemplate: string
    params: Record<string, string | number>
  }
}

export type RiskBandId =
  | 'RISK_0'
  | 'RISK_1'
  | 'RISK_2'
  | 'RISK_3'
  | 'RISK_4'
  | 'RISK_5'
  | 'RISK_6'
  | 'RISK_7'
  | 'RISK_8'

export type RiskBandDef = {
  id: RiskBandId
  label: string
  description: string
  minCoverageWeight: number
  constituents: ConstituentDef[]
}
