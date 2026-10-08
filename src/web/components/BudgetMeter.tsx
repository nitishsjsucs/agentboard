export function BudgetMeter({ label, used, max, format = (n: number) => String(n) }: { label: string; used: number; max: number; format?: (n: number) => string }) {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const tone = ratio >= 1 ? " meter__fill--full" : ratio >= 0.8 ? " meter__fill--warn" : "";
  return (
    <div className="meter" aria-label={`${label}: ${format(used)} of ${format(max)}`}>
      <div className="row small" style={{ justifyContent: "space-between" }}>
        <span className="muted">{label}</span>
        <span>
          {format(used)} / {format(max)}
        </span>
      </div>
      <div className="meter__track">
        <div className={`meter__fill${tone}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}
