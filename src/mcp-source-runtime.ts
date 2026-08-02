import { BundleSearch } from "./search.js";
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

export type SourceRuntime = {
  activeBundleDir: string;
  search?: BundleSearch;
  observedFreshness?: FreshnessState;
  lastRefreshError: RefreshErrorDetails | null;
  inFlightRefresh?: Promise<void>;
  refresh?: RefreshHooks;
  source?: SourceMetadata;
  loadError?: RefreshErrorDetails | null;
  initialLoadError?: unknown;
};

export type WorkspaceSourceRuntime = SourceRuntime & { record: WorkspaceSourceRecord };

export async function createSourceRuntime(options: {
  bundleDir: string;
  search?: BundleSearch;
  refresh?: RefreshHooks;
  source?: SourceMetadata;
  loadError?: unknown;
}): Promise<SourceRuntime> {
  const loadError = options.loadError ? errorDetails(options.loadError) : null;
  const runtime: SourceRuntime = {
    activeBundleDir: options.bundleDir,
    search: options.search,
    refresh: options.refresh,
    source: options.source,
    loadError,
    lastRefreshError: loadError
  };
  if (!runtime.search) {
    try {
      runtime.search = await BundleSearch.fromBundle(runtime.activeBundleDir);
    } catch (error) {
      runtime.initialLoadError = error;
      runtime.lastRefreshError ??= errorDetails(error);
    }
  }
  return runtime;
}

export async function getSourceFreshness(runtime: SourceRuntime): Promise<FreshnessState> {
  if (runtime.loadError) {
    runtime.observedFreshness ??= {
      freshnessStatus: "failed",
      refreshInProgress: false,
      lastRefreshError: runtime.loadError
    };
  } else if (runtime.refresh?.getFreshness) {
    runtime.observedFreshness = await runtime.refresh.getFreshness();
  } else {
    runtime.observedFreshness ??= {
      freshnessStatus: runtime.search ? "fresh" : "missing",
      refreshInProgress: false,
      lastRefreshError: null
    };
  }
  return runtime.observedFreshness;
}

export function startSourceRefresh(
  runtime: SourceRuntime,
  mode: Exclude<RefreshMode, "off">,
  freshness: FreshnessState
): Promise<void> | undefined {
  if (!runtime.refresh?.refreshIfNeeded) return undefined;
  if (runtime.inFlightRefresh) return runtime.inFlightRefresh;

  const refreshPromise = Promise.resolve().then(async () => {
    try {
      const result = await runtime.refresh?.refreshIfNeeded?.({
        mode,
        bundleDir: runtime.activeBundleDir,
        source: runtime.source,
        freshness
      });
      if (result?.freshness) runtime.observedFreshness = result.freshness;
      const nextBundleDir = result?.bundleDir ?? runtime.activeBundleDir;
      const nextSearch = await BundleSearch.fromBundle(nextBundleDir);
      runtime.activeBundleDir = nextBundleDir;
      runtime.search = nextSearch;
      runtime.lastRefreshError = null;
    } catch (error) {
      runtime.lastRefreshError = errorDetails(error);
    } finally {
      if (runtime.inFlightRefresh === refreshPromise) runtime.inFlightRefresh = undefined;
    }
  });
  runtime.inFlightRefresh = refreshPromise;
  return refreshPromise;
}

export async function prepareSourceRuntime(
  runtime: SourceRuntime,
  mode: RefreshMode,
  awaitRefresh: boolean
): Promise<void> {
  if (mode === "off") return;
  const freshness = await getSourceFreshness(runtime);
  if (!shouldRefresh(normalizeFreshness(freshness).freshnessStatus, Boolean(runtime.search)))
    return;
  const refresh = startSourceRefresh(runtime, mode, freshness);
  if (refresh && awaitRefresh) await refresh;
}

export type SourceFreshnessFields = {
  freshnessStatus: FreshnessStatus;
  lastSuccessfulRefreshAt: string | null;
  refreshInProgress: boolean;
  lastRefreshError: RefreshErrorDetails | null;
  nextRefreshAllowedAt: string | null;
};

export function sourceFreshnessFields(runtime: SourceRuntime): SourceFreshnessFields {
  const normalized = normalizeFreshness(runtime.observedFreshness);
  const lastRefreshError = runtime.lastRefreshError ?? normalized.lastRefreshError;
  const refreshInProgress = Boolean(runtime.inFlightRefresh) || normalized.refreshInProgress;
  const freshnessStatus = refreshInProgress
    ? "refreshing"
    : lastRefreshError
      ? "failed"
      : (normalized.freshnessStatus ?? (runtime.search ? "fresh" : "missing"));

  return {
    freshnessStatus,
    lastSuccessfulRefreshAt: normalized.lastSuccessfulRefreshAt,
    refreshInProgress,
    lastRefreshError,
    nextRefreshAllowedAt: normalized.nextRefreshAllowedAt
  };
}

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

function nullableErrorDetails(
  error: FreshnessState["lastRefreshError"]
): RefreshErrorDetails | null {
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
