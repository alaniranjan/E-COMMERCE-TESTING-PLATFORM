import fs from 'node:fs';
import type { ScreenshotInfo } from './types';

/**
 * Screenshot metadata plus the page's accessibility snapshot at failure (from Playwright's
 * error-context file). The snapshot is how a text-only model "sees" the page; the image itself
 * is only sent to models that report vision support.
 */
export function collectScreenshot(screenshotPath?: string, errorContextPath?: string): ScreenshotInfo | undefined {
  const snapshot = errorContextPath && fs.existsSync(errorContextPath) ? pageSnapshotFrom(fs.readFileSync(errorContextPath, 'utf-8')) : undefined;
  if (!screenshotPath || !fs.existsSync(screenshotPath)) {
    return snapshot ? { path: '', bytes: 0, pageSnapshot: snapshot, visibleHeadings: headings(snapshot) } : undefined;
  }
  const buffer = fs.readFileSync(screenshotPath);
  const size = pngSize(buffer);
  return {
    path: screenshotPath,
    bytes: buffer.length,
    width: size?.width,
    height: size?.height,
    pageSnapshot: snapshot,
    visibleHeadings: snapshot ? headings(snapshot) : [],
  };
}

export function screenshotBase64(info?: ScreenshotInfo): string | undefined {
  return info?.path && fs.existsSync(info.path) ? fs.readFileSync(info.path).toString('base64') : undefined;
}

/** The ```yaml block of error-context.md, minus page-footer noise (social links, copyright). */
export function pageSnapshotFrom(errorContext: string): string | undefined {
  const yaml = errorContext.match(/```yaml\n([\s\S]*?)```/)?.[1];
  if (!yaml) return undefined;
  const lines = yaml.split('\n');
  const footer = lines.findIndex((l) => /^- contentinfo:/.test(l));
  return (footer > -1 ? lines.slice(0, footer) : lines).join('\n').trim().slice(0, 3_000);
}

/** Title-like text in the snapshot: headings and quoted standalone text such as "Checkout: Overview". */
function headings(snapshot: string): string[] {
  const found = [
    ...[...snapshot.matchAll(/- heading "([^"]+)"/g)].map((m) => m[1]),
    ...[...snapshot.matchAll(/- text: "([^"]{3,60})"$/gm)].map((m) => m[1]),
  ];
  return [...new Set(found)].slice(0, 5);
}

function pngSize(buffer: Buffer): { width: number; height: number } | undefined {
  const isPng = buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47;
  return isPng ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) } : undefined;
}
