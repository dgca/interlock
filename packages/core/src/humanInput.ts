import { z } from 'zod';
import { assertOwnPropertyContract, InterlockError } from './index.js';
import type { Json } from './index.js';

const inputPath = () => z.string().trim().min(1).max(500);
const choice = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(120),
    requireComment: z.boolean().optional(),
  })
  .strict();

export const humanInputSchema = z
  .object({
    question: z.string().trim().min(1).max(4000),
    questionPath: inputPath().optional(),
    context: z.string().trim().max(32000).optional(),
    contextPath: inputPath().optional(),
    evidence: z
      .object({
        title: z.string().trim().min(1).max(200),
        contentPath: inputPath(),
        revisionPath: inputPath().optional(),
      })
      .strict()
      .optional(),
    answer: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('text') }).strict(),
      z
        .object({
          kind: z.literal('choice'),
          choices: z.array(choice).min(1).max(20),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine(({ answer }, ctx) => {
    if (
      answer.kind === 'choice' &&
      new Set(answer.choices.map((choice) => choice.value)).size !==
        answer.choices.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['answer', 'choices'],
        message: 'Choice values must be unique',
      });
  });

export type HumanInput = z.infer<typeof humanInputSchema>;
export type HumanInputCapture = {
  question: string;
  context?: string;
  evidence?: { title: string; revision?: string; content: string };
  answer: HumanInput['answer'];
};
export type HumanAnswerSource = 'ui' | 'mcp';

const textAnswer = { type: 'string', minLength: 1, maxLength: 20000 };
export function humanAnswerContract(answer: HumanInput['answer']) {
  return answer.kind === 'text'
    ? textAnswer
    : {
        type: 'object',
        properties: {
          choice: {
            type: 'string',
            enum: answer.choices.map((choice) => choice.value),
          },
          comment: textAnswer,
        },
        required: ['choice'],
        additionalProperties: false,
      };
}

export function assertHumanAnswer(answer: HumanInput['answer'], value: Json) {
  assertOwnPropertyContract(humanAnswerContract(answer), value, 'Answer');
  if (answer.kind === 'text') {
    if (!(value as string).trim()) throw new InterlockError('Enter an answer');
    return;
  }
  const { choice, comment } = value as { choice: string; comment?: string };
  const selected = answer.choices.find((option) => option.value === choice);
  if (selected?.requireComment && !comment?.trim())
    throw new InterlockError('This choice requires a comment');
}
