import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fuzzyFilter } from "@writalin/shared";
import { Icon, type IconName } from "./icons";

export interface Command {
  id: string;
  title: string;
  /** Section heading, e.g. "Notes", "Workspaces", "AI". */
  group: string;
  /** One short line under the title saying what it does. */
  description?: string;
  icon?: IconName;
  hint?: string;
  shortcut?: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

function highlight(text: string, indices: number[]): ReactNode {
  if (!indices.length) return text;
  const set = new Set(indices);
  return [...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : ch));
}

/** Ctrl+K palette: fuzzy search over every action and note. */
export function CommandPalette({ open, onClose, commands, placeholder = "Type a command or note name…" }: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 60).map((item) => ({ item, indices: [] as number[], score: 0 }));
    return fuzzyFilter(query, commands, (c) => `${c.title} ${c.keywords ?? ""} ${c.description ?? ""}`, 60);
  }, [query, commands]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    void c.run();
  };

  let lastGroup = "";
  return (
    <div className="w-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="w-palette-search">
        <Icon name="search" />
        <input
          ref={inputRef}
          className="w-palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="w-palette-list"
          aria-activedescendant={results[active] ? `w-cmd-${active}` : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[active]?.item);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <kbd>Esc</kbd>
        </div>
        <ul className="w-palette-list" id="w-palette-list" role="listbox" ref={listRef}>
          {results.length === 0 && <li className="w-palette-empty">Nothing matches “{query}”.</li>}
          {results.map((r, i) => {
            const showGroup = r.item.group !== lastGroup && !query.trim();
            lastGroup = r.item.group;
            return (
              <li key={r.item.id} role="presentation">
                {showGroup && <div className="w-palette-group">{r.item.group}</div>}
                <div
                  id={`w-cmd-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className="w-palette-item"
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(r.item)}
                >
                  <span className="w-palette-icon"><Icon name={r.item.icon ?? "chevronRight"} size={16} /></span>
                  <span className="w-palette-text">
                    <span className="w-palette-title">{highlight(r.item.title, r.indices.filter((x) => x < r.item.title.length))}</span>
                    {(r.item.description || r.item.hint) && <span className="w-palette-desc">{r.item.description ?? r.item.hint}</span>}
                  </span>
                  {query.trim() && <span className="w-palette-meta">{r.item.group}</span>}
                  {r.item.shortcut && <kbd>{r.item.shortcut}</kbd>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="w-palette-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> run</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
