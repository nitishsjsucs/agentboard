// ULID-based ids: run_<ULID>, tsk_<ULID>, apr_<ULID>, call_<ULID>.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now: number = Date.now()): string {
  let time = "";
  let t = Math.floor(now);
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD.charAt((random[i] ?? 0) % 32);
  return time + rand;
}

export const newRunId = (now?: number): string => `run_${ulid(now)}`;
export const newTaskId = (now?: number): string => `tsk_${ulid(now)}`;
export const newApprovalId = (now?: number): string => `apr_${ulid(now)}`;
export const newCallId = (now?: number): string => `call_${ulid(now)}`;

export const RUN_ID_PATTERN = /^run_[0-9A-HJKMNP-TV-Z]{26}$/;
export const TASK_ID_PATTERN = /^tsk_[0-9A-HJKMNP-TV-Z]{26}$/;
export const APPROVAL_ID_PATTERN = /^apr_[0-9A-HJKMNP-TV-Z]{26}$/;
