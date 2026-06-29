import type { BundleSearch } from "./search.js";
import type { WorkspaceSourceRecord } from "./workspace.js";

export type RefreshMode = "off" | "stale-while-refresh" | "blocking";
export type FreshnessStatus = "fresh" | "stale" | "missing" | "failed" | "refreshing";

export type SourceMetadata = {
  name: string;
  kind: string;
  seedUrl: string;
};

export type RefreshErrorDetails = {
  code?: string;
  message: string;
  [key: string]: unknown;
};

export type FreshnessState = {
  freshnessStatus?: FreshnessStatus;
  status?: FreshnessStatus;
  lastSuccessfulRefreshAt?: string | null;
  refreshInProgress?: boolean;
  lastRefreshError?: RefreshErrorDetails | string | Error | null;
  lastError?: RefreshErrorDetails | string | Error | null;
  nextRefreshAllowedAt?: string | null;
};

export type RefreshContext = {
  mode: Exclude<RefreshMode, "off">;
  bundleDir: string;
  source?: SourceMetadata;
  freshness: FreshnessState;
};

export type RefreshResult = {
  bundleDir?: string;
  freshness?: FreshnessState;
};

export type RefreshHooks = {
  mode?: RefreshMode;
  getFreshness?: () => FreshnessState | Promise<FreshnessState>;
  refreshIfNeeded?: (
    context: RefreshContext
  ) => void | RefreshResult | Promise<void | RefreshResult>;
};

export type WorkspaceSourceRuntime = {
  record: WorkspaceSourceRecord;
  activeBundleDir: string;
  search?: BundleSearch;
  observedFreshness?: FreshnessState;
  lastRefreshError: RefreshErrorDetails | null;
  inFlightRefresh?: Promise<void>;
  refresh?: RefreshHooks;
};

export function errorDetails(error: unknown): RefreshErrorDetails {
  if (error instanceof Error) return { message: error.message };
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      ...record,
      message: typeof record.message === "string" ? record.message : "Refresh failed."
    };
  }
  return { message: "Refresh failed." };
}

function nullableErrorDetails(error: FreshnessState["lastRefreshError"]): RefreshErrorDetails | null {
  if (error === undefined || error === null) return null;
  return errorDetails(error);
}

export function normalizeFreshness(state: FreshnessState | undefined): {
  freshnessStatus?: FreshnessStatus;
  lastSuccessfulRefreshAt: string | null;
  refreshInProgress: boolean;
  lastRefreshError: RefreshErrorDetails | null;
  nextRefreshAllowedAt: string | null;
} {
  return {
    freshnessStatus: state?.freshnessStatus ?? state?.status,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    refreshInProgress: Boolean(state?.refreshInProgress),
    lastRefreshError: nullableErrorDetails(state?.lastRefreshError ?? state?.lastError),
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null
  };
}

export function shouldRefresh(status: FreshnessStatus | undefined, hasSearch: boolean): boolean {
  if (!hasSearch) return status !== "fresh";
  return status === "stale" || status === "missing" || status === "failed";
}
