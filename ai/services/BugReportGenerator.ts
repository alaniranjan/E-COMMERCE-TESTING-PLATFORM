import os from 'node:os';
import path from 'node:path';
import type { AIProvider } from '../AIProvider';
import { BUG_PROMPT_VERSION, BUG_SYSTEM_PROMPT, bugOutputSchema, buildBugPrompt, type Priority, type Severity } from '../prompts/bugPrompt';
import type { FailureCategory } from '../prompts/failurePrompt';
import { redactSecrets } from '../security/redact';
import type { FailureAnalysis } from './FailureAnalyzer';
import { providerSettings } from '../providerFactory';
import { structuredCall, type CallAttempt } from './structuredCall';
import { ungroundedQuotes } from './TestCaseGenerator';
import { renderEvidence } from '../../analyzer/EvidenceBuilder';
import type { FailureEvidence } from '../../analyzer/types';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';

export type ReportType = 'PRODUCT BUG' | 'TEST MAINTENANCE' | 'INFRASTRUCTURE' | 'NEEDS TRIAGE';

export const DRAFT_NOTE = 'DRAFT generated with AI assistance. Review and edit before filing. Nothing has been submitted to any issue tracker.';

interface ModelBugReport {
  title: string;
  summary: string;
  preconditions: string[];
  stepsToReproduce: string[];
  expectedResult: string;
  actualResult: string;
  severity: Severity;
  severityReason: string;
  priority: Priority;
  priorityReason: string;
  additionalInvestigation: string[];
}

export interface BugReportDraft {
  status: 'draft';
  /** Always false: drafts are never sent to Jira or any tracker automatically (§17, §49). */
  submitted: false;
  aiStatus: 'generated' | 'unavailable' | 'failed';
  aiMessage?: string;
  reportType: ReportType;
  title: string;
  summary?: string;
  environment: Record<string, string>;
  preconditions: string[];
  stepsToReproduce: string[];
  /** Exactly what the automation did (from the trace or API log), for checking the written steps. */
  recordedActions: string[];
  expectedResult?: string;
  actualResult?: string;
  /** The test's own error message, unedited (secrets masked). */
  rawError: string;
  evidence: { label: string; value: string }[];
  severity?: Severity;
  severityReason?: string;
  priority?: Priority;
  priorityReason?: string;
  classification?: FailureCategory;
  confidenceLabel?: string;
  possibleRootCause?: string;
  additionalInvestigation: string[];
  /** Points for the reviewer: possibly invented text, missing analysis, etc. */
  warnings: string[];
  test: { key: string; title: string; file: string; line: number; project: string; tags: string[] };
  note: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  durationMs: number;
  attempts: CallAttempt[];
}

export function reportTypeFor(classification?: FailureCategory): ReportType {
  switch (classification) {
    case 'APPLICATION_DEFECT': return 'PRODUCT BUG';
    case 'TEST_SCRIPT_DEFECT':
    case 'TEST_DATA_DEFECT': return 'TEST MAINTENANCE';
    case 'ENVIRONMENT_FAILURE':
    case 'NETWORK_FAILURE': return 'INFRASTRUCTURE';
    default: return 'NEEDS TRIAGE'; // AUTHENTICATION_FAILURE can be product or test credentials; UNKNOWN needs a human.
  }
}

/**
 * Builds a bug report draft (§17). Facts come straight from the evidence; the model writes the
 * narrative. If the model is unavailable, the draft still contains every factual section.
 */
export class BugReportGenerator {
  constructor(private readonly provider: AIProvider, private readonly options: { projectRoot: string; timeoutMs?: number }) {}

  async generate(evidence: FailureEvidence, analysis?: FailureAnalysis): Promise<BugReportDraft> {
    const started = Date.now();
    const t = evidence.test;
    const classification = analysis?.status === 'analyzed' ? analysis.classification : undefined;
    const reportType = reportTypeFor(classification);
    const draft: BugReportDraft = {
      status: 'draft',
      submitted: false,
      aiStatus: 'failed',
      reportType,
      title: fallbackTitle(evidence),
      environment: this.environment(evidence),
      preconditions: [],
      stepsToReproduce: [],
      recordedActions: recordedActions(evidence),
      rawError: t.error.message.trim().slice(0, 2_000),
      evidence: this.evidenceList(evidence),
      classification,
      confidenceLabel: analysis?.confidenceLabel,
      possibleRootCause: analysis?.possibleRootCause,
      additionalInvestigation: [],
      warnings: analysis?.status === 'analyzed' ? [...analysis.conflicts] : ['No AI failure analysis was available; report type needs manual triage.'],
      test: { key: t.key, title: t.title, file: t.file, line: t.line, project: t.project, tags: t.tags },
      note: DRAFT_NOTE,
      model: this.provider.model,
      promptVersion: BUG_PROMPT_VERSION,
      createdAt: new Date().toISOString(),
      durationMs: 0,
      attempts: [],
    };

    const evidenceText = renderEvidence(evidence, { visionAttached: false });
    const analysisText = analysis?.status === 'analyzed'
      ? `Classification: ${analysis.classification} (${analysis.confidenceLabel})\nSummary: ${analysis.summary}\nPossible root cause: ${analysis.possibleRootCause}`
      : 'Not available.';

    const call = await structuredCall<ModelBugReport>({
      provider: this.provider,
      system: BUG_SYSTEM_PROMPT,
      prompt: buildBugPrompt({ reportType, analysisText, evidenceText, tags: t.tags }),
      schema: bugOutputSchema,
      timeoutMs: this.options.timeoutMs ?? config.ai.generationTimeoutMs,
      maxTokens: 900,
      temperature: 0.2,
      label: 'bug',
    });
    draft.attempts = call.attempts;
    draft.durationMs = Date.now() - started;

    if (!call.ok) {
      const offline = ['UNAVAILABLE', 'MODEL_NOT_FOUND', 'TIMEOUT'].includes(call.failureCode);
      draft.aiStatus = offline ? 'unavailable' : 'failed';
      draft.aiMessage = call.failureCode === 'UNAVAILABLE'
        ? 'AI sections unavailable - AI provider is offline. Factual sections below are complete.'
        : `AI sections ${offline ? 'unavailable' : 'could not be generated'}: ${call.failureReason}. Factual sections below are complete.`;
      return draft;
    }

    const ai = call.data;
    Object.assign(draft, {
      aiStatus: 'generated',
      title: ai.title.trim(),
      summary: ai.summary.trim(),
      preconditions: ai.preconditions,
      stepsToReproduce: ai.stepsToReproduce,
      expectedResult: ai.expectedResult.trim(),
      actualResult: ai.actualResult.trim(),
      severity: ai.severity,
      severityReason: ai.severityReason.trim(),
      priority: ai.priority,
      priorityReason: ai.priorityReason.trim(),
      additionalInvestigation: ai.additionalInvestigation,
    });
    draft.warnings.push(...reviewWarnings(draft, `${evidenceText}\n${analysisText}`));
    logger.info('ai:bug:drafted', { test: t.title, reportType, severity: ai.severity, priority: ai.priority, warnings: draft.warnings.length, durationMs: draft.durationMs });
    return draft;
  }

  private environment(e: FailureEvidence): Record<string, string> {
    let playwright = 'unknown';
    try { playwright = (require('@playwright/test/package.json') as { version: string }).version; } catch { /* not resolvable */ }
    return {
      'Browser / project': e.test.project,
      'Test environment': e.environment.testEnv,
      'Application URL': e.environment.baseUrl,
      ...(e.api || e.test.project === 'api' ? { 'API URL': e.environment.apiBaseUrl } : {}),
      ...(e.trace?.lastUrl ? { 'Page at failure': e.trace.lastUrl } : {}),
      OS: `${os.type()} ${os.release()}`,
      'Node.js': process.version,
      Playwright: playwright,
      Test: `${e.test.file}:${e.test.line}`,
      ...(e.environment.runId ? { Run: e.environment.runId } : {}),
      ...(e.test.startTime ? { 'Executed at': e.test.startTime } : {}),
    };
  }

  private evidenceList(e: FailureEvidence): { label: string; value: string }[] {
    const rel = (p: string) => path.relative(this.options.projectRoot, p);
    const a = e.test.attachments;
    const list: { label: string; value: string }[] = [];
    if (a.screenshot) list.push({ label: 'Screenshot', value: rel(a.screenshot) });
    if (a.video) list.push({ label: 'Video', value: rel(a.video) });
    if (a.trace) list.push({ label: 'Playwright trace', value: `${rel(a.trace)} (open with: npx playwright show-trace ${rel(a.trace)})` });
    if (e.api?.failing) list.push({ label: 'Failing API call', value: `${e.api.failing.request.split(' ').slice(0, 2).join(' ')} -> HTTP ${e.api.failing.status}: ${e.api.failing.body.slice(0, 200)}` });
    if (e.screenshot?.visibleHeadings.length) list.push({ label: 'Page showed', value: e.screenshot.visibleHeadings.map((h) => `"${h}"`).join(', ') });
    for (const s of e.signals.filter((s) => s.strength === 'strong')) list.push({ label: 'Rule-based observation', value: s.observation });
    return list;
  }
}

function fallbackTitle(e: FailureEvidence): string {
  const firstLine = e.test.error.message.split('\n').find((l) => l.trim())?.trim() ?? 'failed';
  return `[${e.test.project}] ${e.test.title}: ${firstLine}`.slice(0, 120);
}

function recordedActions(e: FailureEvidence): string[] {
  if (e.trace?.actions.length) return e.trace.actions;
  if (e.api?.lines.length) return e.api.lines;
  return [];
}

/** Flags for the reviewer; the draft is kept as written so the human sees what the model produced. */
function reviewWarnings(d: BugReportDraft, groundingText: string): string[] {
  const warnings: string[] = [];
  const text = [d.title, d.summary, d.expectedResult, d.actualResult, ...d.stepsToReproduce, ...d.preconditions].join('\n');
  for (const q of ungroundedQuotes(text, groundingText)) warnings.push(`"${q}" does not appear in the evidence; possibly invented.`);
  if (d.recordedActions.length && d.stepsToReproduce.length > d.recordedActions.length + 3) {
    warnings.push(`The draft has ${d.stepsToReproduce.length} steps but only ${d.recordedActions.length} actions were recorded; check for invented steps.`);
  }
  const codeSteps = d.stepsToReproduce.filter((step) => /getBy\w+\(|locator\(|data-test|\bselector\b/i.test(step));
  if (codeSteps.length) warnings.push(`${codeSteps.length} step(s) contain code or selectors; steps should be plain language for a person.`);
  if (d.reportType === 'TEST MAINTENANCE' && d.severity === 'critical') {
    warnings.push('Critical severity on a test-maintenance report; severity should describe impact on test coverage.');
  }
  return warnings;
}

/** Jira-friendly Markdown. Secrets are masked again on the final text as a last line of defence. */
export function bugReportMarkdown(d: BugReportDraft): string {
  const list = (items: string[], numbered = false) => (items.length ? items.map((s, i) => `${numbered ? `${i + 1}.` : '-'} ${s}`).join('\n') : '_None provided._');
  const lines = [
    `# ${d.title}`,
    '',
    `> ${d.note}`,
    '',
    `**Report type:** ${d.reportType}${d.classification ? ` (AI classification: ${d.classification}, ${d.confidenceLabel})` : ''}`,
    ...(d.aiStatus !== 'generated' ? ['', `**${d.aiMessage}**`] : []),
    '',
    '## Summary', d.summary ?? '_AI summary unavailable._',
    '',
    '## Environment', '| | |', '|---|---|', ...Object.entries(d.environment).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Preconditions', list(d.preconditions),
    '',
    '## Steps to Reproduce', d.stepsToReproduce.length ? list(d.stepsToReproduce, true) : '_See recorded actions below._',
    '',
    '## Expected Result', d.expectedResult ?? '_See the assertion in the raw error below._',
    '',
    '## Actual Result', d.actualResult ?? '', '', '```', d.rawError, '```',
    '',
    '## Evidence', d.evidence.length ? d.evidence.map((e) => `- **${e.label}:** ${e.value}`).join('\n') : '_No artifacts retained._',
    '',
    '## Severity (suggestion)', d.severity ? `**${d.severity}** – ${d.severityReason}` : '_Not suggested._',
    '',
    '## Priority (suggestion)', d.priority ? `**${d.priority}** – ${d.priorityReason}` : '_Not suggested._',
    '',
    '## Possible Root Cause', d.possibleRootCause ?? '_No AI analysis available._',
    '',
    '## Additional Investigation', list(d.additionalInvestigation),
    '',
    '## Recorded actions (from the automation, for checking the steps above)', list(d.recordedActions, true),
  ];
  if (d.warnings.length) lines.push('', '## Review notes', list(d.warnings));
  lines.push('', `_Test: ${d.test.file}:${d.test.line} (${d.test.project}) ${d.test.tags.join(' ')}. Model: ${d.model}, prompt ${d.promptVersion}. Generated ${d.createdAt}._`);
  return redactSecrets(lines.join('\n') + '\n', providerSettings().knownSecrets).text;
}
