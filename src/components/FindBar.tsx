import { useEffect, useRef } from 'react';
import { Braces, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import type { SearchState } from '../state/useSearch';

interface Props {
  search: SearchState;
  copy: (text: string, message?: string) => void;
}

/**
 * Find for every view: type text to match keys, values, types, and paths, or start with `$` for a
 * JSONPath query. Enter and Shift+Enter (or the arrows) step through the matches, selecting each
 * one, so the path bar, code, tree, table, and graph all follow.
 */
export default function FindBar({ search, copy }: Props) {
  const { results, status, error } = search;
  // When a search settles, jump to its first match unless a match is already selected.
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    if (!search.settled) {
      if (!search.searching) jumped.current = null;
      return;
    }
    if (jumped.current === search.settled) return;
    jumped.current = search.settled;
    if (results?.length && search.index < 0) search.step(1);
  }, [search.settled, results]);
  const count = results?.length ?? 0;
  return (
    <div className="find" role="search">
      <label className="find-field">
        <Search size={15} />
        <input
          id="find-input"
          aria-label="Search paths and values"
          placeholder="Find a key, value, or path. Start with $ for a query."
          value={search.query}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              search.step(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape' && search.query) {
              event.stopPropagation();
              search.setQuery('');
            }
          }}
        />
        {search.query && (
          <button
            className="find-clear"
            aria-label="Clear path search"
            title="Clear search (Esc)"
            onClick={() => search.setQuery('')}
          >
            <X size={14} />
          </button>
        )}
      </label>
      {search.searching && (
        <>
          <span className={`find-status ${error ? 'query-error' : ''}`} role="status">
            {status}
          </span>
          <button
            className="find-step"
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            disabled={!count}
            onClick={() => search.step(-1)}
          >
            <ChevronUp size={16} />
          </button>
          <button
            className="find-step"
            aria-label="Next match"
            title="Next match (Enter)"
            disabled={!count}
            onClick={() => search.step(1)}
          >
            <ChevronDown size={16} />
          </button>
          {search.json && count > 0 && (
            <button
              className="find-copy"
              aria-label="Copy query results as JSON"
              title="Copy the results as a JSON array"
              onClick={() => copy(search.json!, 'Query results copied')}
            >
              <Braces size={13} /> Copy
            </button>
          )}
        </>
      )}
    </div>
  );
}
