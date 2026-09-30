/** Shared correction prompt: the original task, what was wrong, and the rejected answer (§13 retry). */
export function buildCorrectionPrompt(originalPrompt: string, previousAnswer: string, problems: string[], wasCutOff: boolean): string {
  const preview = previousAnswer.length > 2_500 ? `${previousAnswer.slice(0, 2_500)}…` : previousAnswer;
  return `${originalPrompt}

YOUR PREVIOUS ANSWER WAS REJECTED.
Problems:
${problems.map((p) => `- ${p}`).join('\n')}
${wasCutOff ? '- The answer was cut off before it finished. Write fewer and shorter items.\n' : ''}
Previous answer:
<<<
${preview}
>>>

Return the corrected answer as JSON only, following the OUTPUT SCHEMA.`;
}
