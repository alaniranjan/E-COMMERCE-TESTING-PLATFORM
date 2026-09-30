import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FailureAnalysis } from './FailureAnalyzer';
import type { RootCauseAnalysis } from './RootCauseAnalyzer';
import { writeJson } from '../../utils/fileUtils';

export const ANALYSIS_DIR = path.resolve(__dirname, '..', '..', 'reports', 'ai-analysis');

export interface AnalysisRecord {
  analysis: FailureAnalysis;
  rootCause?: RootCauseAnalysis;
  groundTruth?: { classification: string; rootCause: string; matches: boolean };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Saves one JSON per failed test, an index, and a readable Markdown report (§32 AI analysis report). */
export function saveRunAnalyses(runLabel: string, records: AnalysisRecord[]): { dir: string; report: string } {
  const dir = path.join(ANALYSIS_DIR, slug(runLabel));
  for (const r of records) writeJson(path.join(dir, `${slug(`${r.analysis.test.title}-${r.analysis.test.project}`)}.json`), r);
  writeJson(path.join(dir, 'index.json'), records.map((r) => ({
    test: r.analysis.test.title, project: r.analysis.test.project, status: r.analysis.status,
    classification: r.analysis.classification, confidence: r.analysis.confidence, conflicts: r.analysis.conflicts.length,
    groundTruthMatch: r.groundTruth?.matches,
  })));
  const report = path.join(dir, 'report.md');
  fs.writeFileSync(report, markdownReport(runLabel, records));
  return { dir, report };
}

export function markdownReport(runLabel: string, records: AnalysisRecord[]): string {
  const lines = [`# AI failure analysis: ${runLabel}`, '', `> ${records[0]?.analysis.advisoryNote ?? 'AI analysis is advisory.'}`, ''];
  lines.push('| Test | Project | Classification | AI confidence estimate | Conflicts |', '|---|---|---|---|---|');
  for (const { analysis: a, groundTruth } of records) {
    const cls = a.status === 'analyzed' ? `${a.classification}${groundTruth ? (groundTruth.matches ? ' ✓' : ` ✗ (expected ${groundTruth.classification})`) : ''}` : a.status;
    lines.push(`| ${a.test.title} | ${a.test.project} | ${cls} | ${a.confidence !== undefined ? `${Math.round(a.confidence * 100)}%` : '—'} | ${a.conflicts.length || '—'} |`);
  }
  for (const r of records) lines.push('', analysisMarkdown(r));
  return lines.join('\n') + '\n';
}

export function analysisMarkdown({ analysis: a, rootCause }: AnalysisRecord): string {
  const out = [`## ${a.test.title} (${a.test.project})`, '', `\`${a.test.file}:${a.test.line}\``, ''];
  if (a.status !== 'analyzed') return [...out, `**${a.message ?? 'AI analysis unavailable.'}**`].join('\n');
  out.push(
    `**Classification:** ${a.classification}  `,
    `**${a.confidenceLabel}** (model said ${Math.round((a.modelConfidence ?? 0) * 100)}%)${a.confidenceAdjustments.length ? `  \nAdjustments: ${a.confidenceAdjustments.join('; ')}` : ''}`,
    '', `**Summary:** ${a.summary}`, '', `**Possible root cause:** ${a.possibleRootCause}`, '',
    `**Why this category:** ${a.classificationReason}`, '',
    '**Evidence:**', ...a.evidence.map((e) => `- ${e}`),
  );
  if (a.removedEvidence.length) out.push('', '**Removed (not found in the collected evidence):**', ...a.removedEvidence.map((e) => `- ~~${e}~~`));
  if (a.conflicts.length) out.push('', '**Conflicts with rule-based checks:**', ...a.conflicts.map((c) => `- ${c}`));
  out.push('', '**Recommended investigation:**', ...a.recommendedInvestigation.map((r) => `- ${r}`));
  out.push('', `**Suggested bug (draft):** ${a.suggestedBugTitle}`, '', a.suggestedBugDescription ?? '');
  if (rootCause?.status === 'analyzed') {
    out.push('', '**Root-cause analysis:**', ...rootCause.possibleCauses.map((c) => `- ${c.cause} (${c.confidenceLabel})`), '', 'Checks:', ...rootCause.recommendedChecks.map((c) => `- ${c}`));
  }
  out.push('', `_Visual inspection: ${a.visualInspection}. Model: ${a.provider}/${a.model}, prompt ${a.promptVersion}, ${Math.round(a.durationMs / 1000)} s${a.cached ? ' (cached)' : ''}._`);
  return out.join('\n');
}

/**
 * Adds a Markdown attachment to the matching failed test (same title and project) in raw Allure
 * results, so it appears in the Allure report next to the screenshot and trace (§32).
 */
export function attachMarkdownToAllure(resultsDir: string, test: { title: string; project: string }, name: string, markdown: string): boolean {
  if (!fs.existsSync(resultsDir)) return false;
  for (const file of fs.readdirSync(resultsDir).filter((f) => f.endsWith('-result.json'))) {
    const full = path.join(resultsDir, file);
    const result = JSON.parse(fs.readFileSync(full, 'utf-8')) as {
      name: string; status: string; parameters?: { name: string; value: string }[]; attachments?: { name: string; source: string; type: string }[];
    };
    const project = result.parameters?.find((p) => p.name === 'Project')?.value;
    if (result.name !== test.title || project !== test.project || !['failed', 'broken'].includes(result.status)) continue;
    const source = `${crypto.randomUUID()}-attachment.md`;
    fs.writeFileSync(path.join(resultsDir, source), markdown);
    result.attachments = [...(result.attachments ?? []).filter((a) => a.name !== name), { name, source, type: 'text/markdown' }];
    fs.writeFileSync(full, JSON.stringify(result));
    return true;
  }
  return false;
}

export function attachToAllure(resultsDir: string, record: AnalysisRecord): boolean {
  return attachMarkdownToAllure(resultsDir, record.analysis.test, 'AI failure analysis', analysisMarkdown(record));
}
