import { useState, type FormEvent } from "react";

export function SearchBar({ initial, onSearch }: { initial: string; onSearch: (query: string) => void }) {
  const [value, setValue] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(value.trim());
  };
  return (
    <form className="row" onSubmit={submit} role="search" style={{ flexWrap: "nowrap" }}>
      <input
        className="input"
        type="search"
        placeholder="Search runs, tasks, tool calls and approvals (for example: Halia Elsworth address change)"
        aria-label="Search history"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn btn--primary">
        Search
      </button>
      {initial ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setValue("");
            onSearch("");
          }}
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}
