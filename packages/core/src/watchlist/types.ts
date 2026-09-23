import type { ActorType, AtsProvider, WatchEventType } from "../domain/enums";

/** One job board of a watched company. */
export interface WatchBoard {
  provider: AtsProvider;
  /** Greenhouse board token, Lever site slug, or Ashby job-board name; null for OTHER. */
  boardIdentifier: string | null;
  /** Canonical board URL for supported providers; the careers page for OTHER. */
  boardUrl: string;
}

/** One watched company: the watch configuration plus the company fields it reuses. */
export interface WatchedCompany {
  watchId: string;
  companyId: string;
  company: string;
  /** Up to three boards, in the owner's order. */
  boards: WatchBoard[];
  active: boolean;
  version: number;
  interestLevel: number | null;
  websiteUrl: string | null;
  companyNotes: string | null;
  applicationCount: number;
  lastEvent: {
    type: WatchEventType;
    actorType: ActorType;
    summary: string;
    occurredAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchActivity {
  activityId: string;
  watchId: string;
  type: WatchEventType;
  actorType: ActorType;
  summary: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

/** Existing company offered when adding a watch, with its watch if it already has one. */
export interface CompanyOption {
  companyId: string;
  name: string;
  watchId: string | null;
  watchActive: boolean | null;
}

export type SafeWatchValue = string | number | boolean | null;

/** Result of every watch mutation. Company notes text is never included. */
export interface WatchMutationResult {
  ok: true;
  operation: string;
  requestId: string;
  replayed: boolean;
  noop: boolean;
  watchId: string;
  companyId: string;
  company: string;
  /** Creation only: true when the company row was created by this save. */
  companyCreated?: boolean;
  active: boolean;
  version: number;
  activityId: string | null;
  summary: string;
  changedFields: string[];
  before: Record<string, SafeWatchValue>;
  after: Record<string, SafeWatchValue>;
}

/** A company as the discovery service needs it. */
export interface CompanyRef {
  companyId: string;
  name: string;
  websiteUrl: string | null;
}

/** A watch reduced to what board conflict checks and suggestions need. */
export interface WatchSummary {
  watchId: string;
  companyId: string;
  company: string;
  boards: WatchBoard[];
}

export interface WatchListQuery {
  text?: string;
  active?: boolean;
  provider?: AtsProvider;
  limit: number;
  cursor?: string;
}
