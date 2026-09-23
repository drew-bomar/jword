import type { ActorType, AtsProvider, WatchEventType } from "../domain/enums";

/** One watched company: the watch configuration plus the company fields it reuses. */
export interface WatchedCompany {
  watchId: string;
  companyId: string;
  company: string;
  provider: AtsProvider;
  /** Greenhouse board token, Lever site slug, or Ashby job-board name; null for OTHER. */
  boardIdentifier: string | null;
  /** Canonical board URL for supported providers; optional careers page for OTHER. */
  boardUrl: string | null;
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

export interface WatchListQuery {
  text?: string;
  active?: boolean;
  provider?: AtsProvider;
  limit: number;
  cursor?: string;
}
