import {
  Building2,
  Globe2,
  Layers3,
  Lightbulb,
  ShieldHalf,
  Sparkles,
  TrendingUp,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { NodeKind } from '../lib/marketGraph'

export const NODE_META: Record<NodeKind, { label: string; icon: LucideIcon; color: string }> = {
  idea: { label: 'Idea', icon: Sparkles, color: '#37e0b0' },
  segment: { label: 'Segments', icon: Layers3, color: '#e0b23a' },
  company: { label: 'Companies', icon: Building2, color: '#ff7a59' },
  founder: { label: 'Founders', icon: UserRound, color: '#a98bff' },
  investor: { label: 'Investors', icon: Wallet, color: '#4ea1ff' },
  feature: { label: 'Features', icon: Sparkles, color: '#5fd0e6' },
  moat: { label: 'Moats', icon: ShieldHalf, color: '#6fe06f' },
  source: { label: 'Sources', icon: Globe2, color: '#8a93a6' },
  opportunity: { label: 'White space', icon: Lightbulb, color: '#ffc24b' },
  trend: { label: 'Trends', icon: TrendingUp, color: '#c0d15a' },
}
