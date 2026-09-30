import fs from 'node:fs';
import path from 'node:path';
import type { AIProvider } from '../AIProvider';
import {
  buildTestCasePrompt, DEFAULT_TYPES, EXAMPLE_TITLE, TEST_CASE_PROMPT_VERSION,
  TEST_CASE_SYSTEM_PROMPT, TEST_CASE_TYPES, testCaseOutputSchema, type TestCaseType,
} from '../prompts/testCasePrompt';
import { structuredCall, type CallAttempt } from './structuredCall';
import { config } from '../../utils/config';
import { logger } from '../../utils/logger';

export interface RawTestCase {
  id: string;
  title: string;
  type: TestCaseType;
  priority: 'high' | 'medium' | 'low';
  preconditions: string[];
  steps: string[];
  expectedResult: string;
}

/** A generated case is a draft: a QA engineer must review it before it is used (§38, §49). */
export interface GeneratedTestCase extends RawTestCase {
  reviewStatus: 'pending' | 'approved' | 'rejected';
  warnings: string[];
}

export type GenerationAttempt = CallAttempt;

export interface GenerationResult {
  status: 'success' | 'failed';
  requirement: string;
  testCases: GeneratedTestCase[];
  assumptions: string[];
  /** Issues fixed automatically or needing reviewer attention (they do not fail the generation). */
  warnings: string[];
  failureReason?: string;
  failureCode?: string;
  attempts: GenerationAttempt[];
  provider: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  totalDurationMs: number;
}

export interface GenerationInput {
  requirement: string;
  maxCases?: number;
  types?: TestCaseType[];
}

export class GenerationInputError extends Error {}

export const REQUIREMENT_LIMITS = { min: 10, max: 4_000 } as const;
export const MAX_CASES_LIMIT = 15;

/** Wording that overstates what a test can prove (§14: no unrealistic security claims). */
const OVERCLAIM = /\b(guarantee[sd]?|fully secure|100% secure|completely secure|prevents? all|immune to|unhackable|proves? (?:that )?(?:the )?(?:system|application|site) is secure)\b/i;

export class TestCaseGenerator {
  constructor(
    private readonly provider: AIProvider,
    private readonly options: { maxAttempts?: number; timeoutMs?: number; appContext?: string } = {},
  ) {}

  async generate(input: GenerationInput): Promise<GenerationResult> {
    const requirement = input.requirement?.trim() ?? '';
    if (requirement.length < REQUIREMENT_LIMITS.min || requirement.length > REQUIREMENT_LIMITS.max) {
      throw new GenerationInputError(`Requirement must be ${REQUIREMENT_LIMITS.min}-${REQUIREMENT_LIMITS.max} characters (got ${requirement.length}).`);
    }
    const maxCases = input.maxCases ?? 5;
    if (!Number.isInteger(maxCases) || maxCases < 1 || maxCases > MAX_CASES_LIMIT) {
      throw new GenerationInputError(`maxCases must be an integer from 1 to ${MAX_CASES_LIMIT}.`);
    }
    const types = input.types?.length ? input.types : DEFAULT_TYPES;
    const unknownTypes = types.filter((t) => !TEST_CASE_TYPES.includes(t));
    if (unknownTypes.length) throw new GenerationInputError(`Unknown test case types: ${unknownTypes.join(', ')}`);

    const schema = testCaseOutputSchema(maxCases);
    const appContext = this.appContext();
    const prompt = buildTestCasePrompt({ requirement, appContext, maxCases, types });
    const started = Date.now();
    const result: GenerationResult = {
      status: 'failed', requirement, testCases: [], assumptions: [], warnings: [], attempts: [],
      provider: this.provider.name, model: this.provider.model, promptVersion: TEST_CASE_PROMPT_VERSION,
      createdAt: new Date().toISOString(), totalDurationMs: 0,
    };

    const call = await structuredCall<{ testCases: RawTestCase[]; assumptions: string[] }>({
      provider: this.provider,
      system: TEST_CASE_SYSTEM_PROMPT,
      prompt,
      schema,
      semanticCheck: semanticErrors,
      maxAttempts: this.options.maxAttempts,
      timeoutMs: this.options.timeoutMs ?? config.ai.generationTimeoutMs,
      maxTokens: Math.max(config.ai.maxTokens, 350 * maxCases),
      label: 'testcases',
    });
    result.attempts = call.attempts;

    if (call.ok) {
      const cleaned = postProcess(call.data.testCases, types, `${appContext}\n${requirement}`);
      result.status = 'success';
      result.testCases = cleaned.testCases;
      result.assumptions = call.data.assumptions;
      result.warnings.push(...cleaned.warnings);
      if (call.method !== 'direct') result.warnings.push(`JSON had to be extracted from the response (${call.method}).`);
      if (call.attempts.length > 1) result.warnings.push(`Valid output only after ${call.attempts.length} attempts.`);
    } else {
      result.failureCode = call.failureCode;
      result.failureReason = call.failureReason;
    }

    result.totalDurationMs = Date.now() - started;
    logger.info('ai:testcases:done', {
      status: result.status, cases: result.testCases.length, attempts: result.attempts.length,
      durationMs: result.totalDurationMs, failureCode: result.failureCode,
    });
    return result;
  }

  private appContext(): string {
    if (this.options.appContext !== undefined) return this.options.appContext;
    const file = path.resolve(__dirname, '..', '..', config.ai.appContextFile);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  }
}

/** Problems that make the output unusable, so the model gets a correction prompt. */
function semanticErrors(data: { testCases: RawTestCase[] }): string[] {
  const errors: string[] = [];
  data.testCases.forEach((tc, i) => {
    const where = `testCases[${i}]`;
    if (!tc.title.trim()) errors.push(`${where}.title is blank`);
    if (!tc.expectedResult.trim()) errors.push(`${where}.expectedResult is blank`);
    if (tc.steps.some((s) => !s.trim())) errors.push(`${where}.steps contains a blank step`);
    if (tc.title.trim().toLowerCase() === EXAMPLE_TITLE.toLowerCase()) {
      errors.push(`${where} copies the prompt's example instead of testing the requirement`);
    }
  });
  return errors;
}

/** Deterministic clean-up that does not need the model: renumbering, de-duplication, reviewer warnings. */
function postProcess(raw: RawTestCase[], requestedTypes: readonly TestCaseType[], groundingText: string): { testCases: GeneratedTestCase[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const unique = raw.filter((tc) => {
    const key = tc.title.trim().toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Removed duplicate test case "${tc.title.trim()}".`);
      return false;
    }
    seen.add(key);
    return true;
  });

  const testCases = unique.map((tc, i): GeneratedTestCase => {
    const id = `TC${String(i + 1).padStart(3, '0')}`;
    const caseWarnings: string[] = [];
    const text = [tc.title, tc.expectedResult, ...tc.steps].join(' ');
    if (OVERCLAIM.test(text)) caseWarnings.push('Overstated claim (e.g. "guarantees"/"fully secure"); a test can only show specific behaviour.');
    if (tc.steps.length > 8) caseWarnings.push(`Long test (${tc.steps.length} steps); consider splitting.`);
    for (const quoted of ungroundedQuotes(text, groundingText)) {
      caseWarnings.push(`"${quoted}" does not appear in the requirement or application context; possibly invented.`);
    }
    return {
      id,
      title: tc.title.trim(),
      type: tc.type,
      priority: tc.priority,
      preconditions: tc.preconditions.map((p) => p.trim()).filter(Boolean),
      steps: tc.steps.map((s) => s.trim()),
      expectedResult: tc.expectedResult.trim(),
      reviewStatus: 'pending',
      warnings: caseWarnings,
    };
  });

  if (raw.some((tc, i) => tc.id !== `TC${String(i + 1).padStart(3, '0')}`)) warnings.push('Test case ids were renumbered.');
  const covered = new Set(testCases.map((tc) => tc.type));
  const missing = requestedTypes.filter((t) => !covered.has(t));
  if (missing.length) warnings.push(`No test cases of type: ${missing.join(', ')}.`);
  return { testCases, warnings };
}

/**
 * Hallucination guard: text the model puts in quotes (messages, labels) must exist in what it was given.
 * Cheap and deterministic; it cannot judge unquoted claims, which is what human review is for.
 */
export function ungroundedQuotes(text: string, groundingText: string): string[] {
  const haystack = normalise(groundingText);
  // Quotes must open after a boundary and close before one, so apostrophes ("user's") are not quotes.
  const quotes = [...text.matchAll(/(?:^|[\s(:])["'\u2018\u201C]([^"'\u2018\u2019\u201C\u201D\n]{3,120})["'\u2019\u201D](?=$|[\s.,;:)!?])/g)].map((m) => m[1].trim());
  // Unquoted app messages: this shop's errors start with "Error:" or "Epic sadface:".
  const messages = [...text.matchAll(/\b((?:Error|Epic sadface):[^"'\u201C\u201D\n]{3,150}?)(?=\s+(?:is|are)\s+(?:displayed|shown)|["'\u201D]|[.;]\s|[.;]?$)/g)]
    .map((m) => m[1].trim());
  return [...new Set([...quotes, ...messages])].filter((q) => q && !haystack.includes(normalise(q)));
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[.!]+$/g, '').replace(/\s+/g, ' ').trim();
}

/** $id is for our validator; it is not part of the constraint sent to the model. */
function stripId<T extends { $id?: string }>(schema: T): Omit<T, '$id'> {
  const { $id: _id, ...rest } = schema;
  return rest;
}
