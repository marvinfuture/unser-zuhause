import type { BaseRecord, ProfileId } from "./types.js";

export interface RewardAccount {
  enabled: boolean;
  version: number;
  balances: Record<ProfileId, number>;
}
export interface Reward extends BaseRecord {
  title: string;
  cost: number;
}
export interface RewardEntry extends BaseRecord {
  title: string;
  points: number;
  sourceId: string;
}
export interface RewardState extends RewardAccount {
  rewards: Reward[];
  recent: RewardEntry[];
}
