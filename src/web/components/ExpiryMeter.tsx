import { formatDuration, formatDurationWords, useNow } from "../api/time.ts";
import { formatTime } from "./RunTable.tsx";

const HOUR = 3_600_000;

/**
 * Time left on a pending approval. The fill is the elapsed share of its window (requested to expiry),
 * like every other meter in the console: fuller is closer to the limit. It turns to the warning colour
 * under 24 hours left and the danger colour under 6; the text always carries the value.
 */
export function ExpiryMeter({ requestedAt, expiresAt }: { requestedAt: string; expiresAt: string }) {
  const now = useNow(30_000);
  const start = Date.parse(requestedAt);
  const end = Date.parse(expiresAt);
  const total = Math.max(1, end - start);
  const left = end - now;
  const passed = !(left > 0);
  const elapsed = passed ? 1 : Math.min(1, Math.max(0, (now - start) / total));
  const tone = passed || left < 6 * HOUR ? " meter__fill--full" : left < 24 * HOUR ? " meter__fill--warn" : "";
  const percent = Math.round(elapsed * 100);
  return (
    <div className="expiry" data-testid="expiry">
      <span className="small muted" data-testid="expiry-text">
        {passed ? "expiry passed; the list updates shortly" : `expires in ${formatDuration(left)} (${formatTime(expiresAt)})`}
      </span>
      <div
        className="meter__track"
        role="meter"
        aria-label="Time left to decide"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={passed ? "expiry passed" : `${formatDurationWords(left)} left of ${formatDurationWords(total)}`}
      >
        <div className={`meter__fill${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
