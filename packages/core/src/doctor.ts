import { z } from 'zod';

export const diagnosticCategorySchema = z.enum([
  'system',
  'harnesses',
  'triggers',
  'blockers',
  'workflows',
]);
export type DiagnosticCategory = z.infer<typeof diagnosticCategorySchema>;

export const diagnosticStatusSchema = z.enum(['ok', 'warn', 'fail']);
export type DiagnosticStatus = z.infer<typeof diagnosticStatusSchema>;

export const diagnosticCheckSchema = z.object({
  category: diagnosticCategorySchema,
  name: z.string().min(1),
  status: diagnosticStatusSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  remediation: z.string().optional(),
});
export type DiagnosticCheck = z.infer<typeof diagnosticCheckSchema>;

export const doctorReportSchema = z.object({
  status: diagnosticStatusSchema,
  checkedAt: z.string(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    ok: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
  }),
  checks: z.array(diagnosticCheckSchema),
});
export type DoctorReport = z.infer<typeof doctorReportSchema>;

export const doctorOptionsSchema = z
  .object({
    live: z.boolean().optional(),
  })
  .strict();
export type DoctorOptions = z.infer<typeof doctorOptionsSchema>;
