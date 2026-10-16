import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

export interface TabSpec<K extends string> {
  key: K;
  label: string;
}

const tabId = (id: string, key: string) => `${id}-tab-${key || "all"}`;
const panelId = (id: string, key: string) => `${id}-panel-${key || "all"}`;

/**
 * A WAI-ARIA tablist with a roving tabindex: Tab reaches the selected tab only, and ArrowLeft,
 * ArrowRight, Home and End move between tabs, selecting and focusing them.
 */
export function TabList<K extends string>({
  id,
  label,
  tabs,
  selected,
  onSelect,
  className = "tabs",
  style,
}: {
  id: string;
  label: string;
  tabs: readonly TabSpec<K>[];
  selected: K;
  onSelect: (key: K) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const target = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (target === null) return;
    event.preventDefault();
    const next = tabs[target];
    if (!next) return;
    onSelect(next.key);
    document.getElementById(tabId(id, next.key))?.focus();
  };
  return (
    <div className={className} role="tablist" aria-label={label} style={style}>
      {tabs.map((tab, index) => (
        <button
          key={tab.key || "all"}
          id={tabId(id, tab.key)}
          type="button"
          role="tab"
          className="tab"
          aria-selected={selected === tab.key}
          aria-controls={panelId(id, tab.key)}
          tabIndex={selected === tab.key ? 0 : -1}
          onClick={() => onSelect(tab.key)}
          onKeyDown={(event) => move(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** The panel for one tab; only the selected tab's panel is shown and holds content. */
export function TabPanel({ id, tabKey, selected, children }: { id: string; tabKey: string; selected: boolean; children?: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(id, tabKey)} aria-labelledby={tabId(id, tabKey)} hidden={!selected} tabIndex={selected ? 0 : -1} className="tabpanel">
      {selected ? children : null}
    </div>
  );
}
