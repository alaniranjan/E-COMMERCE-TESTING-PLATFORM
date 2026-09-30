/** Everything collected about one failed test. Rendered to text for the model by EvidenceBuilder. */
export interface FailedTest {
  /** Playwright's stable test id + project, unique within a run. */
  key: string;
  testId: string;
  title: string;
  titlePath: string[];
  file: string;
  line: number;
  project: string;
  /** Playwright tags, e.g. ["@smoke", "@regression"]. */
  tags: string[];
  status: string;
  retry: number;
  durationMs: number;
  startTime?: string;
  error: { message: string; stack?: string; location?: { file: string; line: number; column: number } };
  attachments: {
    screenshot?: string;
    video?: string;
    trace?: string;
    errorContext?: string;
    testLog?: string; // inline NDJSON
    apiExchanges?: string; // inline JSON
  };
}

export interface TraceSummary {
  actions: string[];
  failedAction?: string;
  lastUrl?: string;
  consoleErrors: string[];
  failedRequests: string[];
}

export interface ScreenshotInfo {
  path: string;
  bytes: number;
  width?: number;
  height?: number;
  /** Accessibility snapshot of the page at failure (from Playwright's error-context), if available. */
  pageSnapshot?: string;
  /** Headings/titles visible in the snapshot, e.g. "Checkout: Overview". */
  visibleHeadings: string[];
}

export interface ApiExchangeSummary {
  lines: string[];
  failing?: { request: string; status: number; body: string };
}

export type SignalStrength = 'strong' | 'weak';

/** Deterministic observations (facts, not conclusions) derived from the evidence. */
export interface Signal {
  id: string;
  strength: SignalStrength;
  observation: string;
  /** Category this observation usually points to; used for the consistency check, not given to the model as an answer. */
  suggests?: string;
}

export interface FailureEvidence {
  test: FailedTest;
  environment: { testEnv: string; baseUrl: string; apiBaseUrl: string; browser: string; runId?: string };
  sourceExcerpt?: string;
  trace?: TraceSummary;
  screenshot?: ScreenshotInfo;
  logs: string[];
  api?: ApiExchangeSummary;
  signals: Signal[];
  /** Collection problems (missing files etc.). Analysis continues with what is available. */
  collectionNotes: string[];
}
