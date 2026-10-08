import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types.ts";
import { apiError } from "./errors.ts";

/** zod validation that answers 400 invalid_request in the ApiError shape. */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(target: Target, schema: Schema) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const message = z.prettifyError(result.error as unknown as z.ZodError).slice(0, 500);
      return apiError(c as unknown as Parameters<typeof apiError>[0], 400, "invalid_request", message);
    }
    return undefined;
  });
}

export type { AppEnv };
