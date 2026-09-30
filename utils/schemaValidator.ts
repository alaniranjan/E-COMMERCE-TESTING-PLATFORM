import Ajv, { type AnySchema, type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';

// multipleOfPrecision: money checks (multipleOf 0.01) must tolerate binary floating point, e.g. 75.57.
const ajv = new Ajv({ allErrors: true, strict: false, multipleOfPrecision: 9 });
addFormats(ajv);

export interface SchemaResult {
  valid: boolean;
  errors: string[];
}

/** Validates data and returns readable errors like "/items/0/price must be >= 0.01". */
export function validateSchema(schema: AnySchema, data: unknown): SchemaResult {
  const validate = ajv.getSchema((schema as { $id?: string }).$id ?? '') ?? ajv.compile(schema);
  const valid = validate(data) as boolean;
  return { valid, errors: (validate.errors ?? []).map(formatError) };
}

function formatError(e: ErrorObject): string {
  const where = e.instancePath || '(root)';
  if (e.keyword === 'additionalProperties') return `${where} has unexpected property "${e.params.additionalProperty}"`;
  return `${where} ${e.message}`;
}
