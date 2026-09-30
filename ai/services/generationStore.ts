import path from 'node:path';
import { fileTimestamp } from '../../utils/dateUtils';
import { writeJson } from '../../utils/fileUtils';
import type { GenerationResult } from './TestCaseGenerator';

export const GENERATED_DIR = path.resolve(__dirname, '..', '..', 'reports', 'ai-generated');

/** Every generation (successful or not) is stored as JSON for review and traceability (§30: store AI responses). */
export function saveGeneration(result: GenerationResult): string {
  const slug = result.requirement.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'requirement';
  const file = path.join(GENERATED_DIR, `${fileTimestamp(new Date(result.createdAt))}-${slug}.json`);
  writeJson(file, result);
  return file;
}
