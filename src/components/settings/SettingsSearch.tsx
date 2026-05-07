import { Icon } from "../ui/Icon";

/**
 * Debounce-free filter over the settings nav. Lifted into Settings.tsx
 * which holds the query and uses it to (a) filter visible nav items and
 * (b) dim non-matching content sections.
 */
export function SettingsSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="settings-search">
      <span className="settings-search-icon" aria-hidden="true">
        <Icon name="search" size={13} />
      </span>
      <input
        type="text"
        value={value}
        placeholder="Search settings…"
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label="Search settings"
      />
      {value && (
        <button
          type="button"
          className="settings-search-clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <Icon name="x" size={11} />
        </button>
      )}
    </div>
  );
}
