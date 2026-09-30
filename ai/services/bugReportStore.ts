import fs from 'node:fs';
import path from 'node:path';
import { bugReportMarkdown, type BugReportDraft } from './BugReportGenerator';
import { writeJson } from '../../utils/fileUtils';

export const BUG_REPORT_DIR = path.resolve(__dirname, '..', '..', 'reports', 'bug-reports');

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Saves each draft as Markdown (ready to paste into a tracker) and JSON, plus an index for the run. */
export function saveBugReports(runLabel: string, drafts: BugReportDraft[]): string {
  const dir = path.join(BUG_REPORT_DIR, slug(runLabel));
  for (const d of drafts) {
    const name = slug(`${d.test.title}-${d.test.project}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.md`), bugReportMarkdown(d));
    writeJson(path.join(dir, `${name}.json`), d);
  }
  writeJson(path.join(dir, 'index.json'), drafts.map((d) => ({
    test: d.test.title, project: d.test.project, reportType: d.reportType, title: d.title,
    severity: d.severity, priority: d.priority, aiStatus: d.aiStatus, warnings: d.warnings.length, submitted: d.submitted,
  })));
  return dir;
}
