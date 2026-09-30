/**
 * npm run ai:analyze [-- --report reports/results.json] [--root-cause] [--bug-reports] [--limit N] [--no-cache] [--no-allure]
 * Analyzes every failed test in a Playwright JSON report with the configured model.
 * If the model is unavailable, each failure is recorded as "AI analysis unavailable"; test results are untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createAIProvider } from '../ai/providerFactory';
import { attachMarkdownToAllure, attachToAllure, saveRunAnalyses, type AnalysisRecord } from '../ai/services/analysisStore';
import { BugReportGenerator, bugReportMarkdown, type BugReportDraft } from '../ai/services/BugReportGenerator';
import { saveBugReports } from '../ai/services/bugReportStore';
import { FailureAnalyzer } from '../ai/services/FailureAnalyzer';
import { RootCauseAnalyzer } from '../ai/services/RootCauseAnalyzer';
import { buildEvidence } from '../analyzer/EvidenceBuilder';
import { runIdFrom } from '../analyzer/LogCollector';
import { parseFailedTests } from '../analyzer/TestResultParser';
import { testConfig } from '../config/testConfig';

const ROOT = path.resolve(__dirname, '..');
const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };

export async function analyzeFailures(opts: { report?: string; rootCause?: boolean; bugReports?: boolean; limit?: number; useCache?: boolean; allure?: boolean } = {}): Promise<AnalysisRecord[]> {
  const reportPath = path.resolve(ROOT, opts.report ?? path.join(testConfig.reportsDir, 'results.json'));
  const failed = parseFailedTests(reportPath, ROOT).slice(0, opts.limit ?? Infinity);
  if (!failed.length) {
    console.log('No failed tests in the report; nothing to analyze.');
    return [];
  }

  const provider = createAIProvider();
  const health = await provider.healthCheck();
  const analyzer = new FailureAnalyzer(provider, { useCache: opts.useCache });
  const rootCauseAnalyzer = opts.rootCause ? new RootCauseAnalyzer(provider) : undefined;
  const bugGenerator = opts.bugReports ? new BugReportGenerator(provider, { projectRoot: ROOT }) : undefined;
  const drafts: BugReportDraft[] = [];
  const groundTruth = loadGroundTruth();
  console.log(`${failed.length} failed test(s). AI: ${health.message}\n`);

  const records: AnalysisRecord[] = [];
  for (const [i, test] of failed.entries()) {
    const evidence = buildEvidence(test, ROOT, runIdFrom(test.attachments.testLog));
    process.stdout.write(`[${i + 1}/${failed.length}] ${test.title} (${test.project}) … `);
    const analysis = health.modelAvailable ? await analyzer.analyze(evidence) : analyzer.unavailable(evidence, health.available ? health.message : 'AI provider is offline.');
    const rootCause = rootCauseAnalyzer && analysis.status === 'analyzed' ? await rootCauseAnalyzer.analyze(evidence) : undefined;

    const truth = groundTruth[test.title.split(' ')[0]];
    const record: AnalysisRecord = {
      analysis, rootCause,
      groundTruth: truth && analysis.classification ? { ...truth, matches: truth.classification === analysis.classification } : undefined,
    };
    records.push(record);
    if (opts.allure !== false) attachToAllure(path.resolve(ROOT, testConfig.allureResultsDir), record);

    if (bugGenerator) {
      // Without a usable model the draft still has every factual section (§48).
      const draft = health.modelAvailable ? await bugGenerator.generate(evidence, analysis) : await bugGenerator.generate(evidence);
      drafts.push(draft);
      if (opts.allure !== false) attachMarkdownToAllure(path.resolve(ROOT, testConfig.allureResultsDir), test, 'AI bug report draft', bugReportMarkdown(draft));
    }

    console.log(analysis.status === 'analyzed'
      ? `${analysis.classification} (${analysis.confidenceLabel}${analysis.conflicts.length ? ', conflicts with rule-based check' : ''})${record.groundTruth ? (record.groundTruth.matches ? ' ✓ matches ground truth' : ` ✗ expected ${record.groundTruth.classification}`) : ''} ${Math.round(analysis.durationMs / 1000)}s${analysis.cached ? ' cached' : ''}`
      : analysis.message);
  }

  const runLabel = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const { report } = saveRunAnalyses(runLabel, records);
  console.log(`\nReport: ${path.relative(ROOT, report)}`);
  if (drafts.length) {
    const dir = saveBugReports(runLabel, drafts);
    console.log(`Bug report drafts (${drafts.length}, not submitted anywhere): ${path.relative(ROOT, dir)}/`);
    for (const d of drafts) console.log(`  - [${d.reportType}] ${d.title}${d.severity ? ` (${d.severity}/${d.priority})` : ''}${d.warnings.length ? ` - ${d.warnings.length} review note(s)` : ''}`);
  }
  const judged = records.filter((r) => r.groundTruth);
  if (judged.length) console.log(`Ground truth: ${judged.filter((r) => r.groundTruth!.matches).length}/${judged.length} classifications match.`);
  console.log('AI analysis is advisory and requires human verification.');
  return records;
}

function loadGroundTruth(): Record<string, { classification: string; rootCause: string }> {
  const file = path.join(ROOT, 'ai', 'eval', 'demo-ground-truth.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
}

if (require.main === module) {
  analyzeFailures({
    report: option('report'),
    rootCause: flag('root-cause'),
    bugReports: flag('bug-reports'),
    limit: option('limit') ? Number(option('limit')) : undefined,
    useCache: !flag('no-cache'),
    allure: !flag('no-allure'),
  }).catch((err) => {
    console.error(`Failure analysis could not run: ${(err as Error).message}`);
    process.exit(1);
  });
}
