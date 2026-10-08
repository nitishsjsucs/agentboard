import { z } from "zod";

/** One dispatch of one task (SPEC section 7.2). There is no epoch: it is assigned at claim time. */
export const TaskMessage = z.object({
  v: z.literal(1),
  runId: z.string().regex(/^run_[0-9A-HJKMNP-TV-Z]{26}$/),
  taskId: z.string().regex(/^tsk_[0-9A-HJKMNP-TV-Z]{26}$/),
  role: z.enum(["planner", "executor", "verifier"]),
  /** Unique per dispatch; the fence for claims and DLQ handling. */
  dispatchId: z.uuid(),
  attempt: z.number().int().min(1),
  enqueuedAt: z.number().int(),
});
export type TaskMessage = z.infer<typeof TaskMessage>;
