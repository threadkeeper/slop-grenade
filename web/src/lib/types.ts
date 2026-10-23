export type AnimationTier =
  | 'human_sparkle'
  | 'peaceful_cloud'
  | 'innocent_fruit'
  | 'slop_splat'
  | 'slop_grenade';

export type M365App = 'teams' | 'outlook' | 'share_point' | 'word' | 'copilot_chat' | 'other';

export type MessageDirection = 'received' | 'sent';

export type MonitorSide = 'left' | 'right';

export interface SlopSignal {
  category:
    | 'lexical_cliche'
    | 'structural_symmetry'
    | 'low_burstiness'
    | 'passive_handoff'
    | 'channel_mismatch'
    | 'luna_semantic';
  label: string;
  weight: number;
  excerpt: string;
}

export interface SignalBreakdown {
  lexicalScore: number;
  structuralScore: number;
  burstinessScore: number;
  handoffScore: number;
  lunaScore: number | null;
}

export interface SlopReport {
  messageId: string;
  app: M365App;
  direction: MessageDirection;
  sender: string;
  subjectOrTopic: string;
  timestamp: string;
  wordCount: number;
  slopScore: number;
  heuristicScore: number;
  lunaScore: number | null;
  tier: AnimationTier;
  isSlopGrenade: boolean;
  monitorSide: MonitorSide;
  breakdown: SignalBreakdown;
  signals: SlopSignal[];
  summary: string;
  selfAwarenessTip: string;
  redactedPreview: string;
}

export interface AnimationEvent {
  sequence: number;
  report: SlopReport;
}

export interface DirectionalStats {
  totalMessages: number;
  averageSlopScore: number;
  humanSparkles: number;
  peacefulClouds: number;
  innocentFruits: number;
  slopSplats: number;
  slopGrenades: number;
  cleanHumanStreak: number;
}

export interface AwarenessScorecard {
  sentByMe: DirectionalStats;
  receivedByMe: DirectionalStats;
  selfAwarenessVerdict: string;
  recentReports: SlopReport[];
}

export interface WorkIqStatus {
  binaryFound: boolean;
  binaryPath: string | null;
  version: string | null;
  mcpReady: boolean;
  mcpToolCount: number;
  account: string | null;
  message: string;
}

export interface LunaAuthStatus {
  authenticated: boolean;
  tokenSource: string;
  githubLogin: string | null;
  model: string;
  endpoint: string;
  enabled: boolean;
  message: string;
}

export interface CombinedAuthStatus {
  serviceTreeRequired: boolean;
  workiq: WorkIqStatus;
  githubLuna: LunaAuthStatus;
}
