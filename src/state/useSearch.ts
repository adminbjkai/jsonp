import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { entryMatcher, type Entry } from '../lib/json';
import { isQuery } from '../lib/query';
import type { QueryReply } from '../workers/query.worker';

/**
 * The search shared by every view. Plain text matches keys, values, types, and paths. A search that
 * starts with `$` runs as a JSONPath query in a worker, stopped if it runs long. Either way the
 * result is one list of values in document order that can be stepped through.
 */
export function useSearch(
  entries: Entry[],
  source: string,
  active: string | null,
  select: (path: string) => boolean,
) {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const expression = deferred.trim();
  const queryMode = isQuery(deferred);
  const byPath = useMemo(() => new Map(entries.map((entry) => [entry.path, entry])), [entries]);
  const matcher = useMemo(() => entryMatcher(entries), [entries]);

  const [reply, setReply] = useState<(QueryReply & { expression: string }) | null>(null);
  useEffect(() => {
    if (!queryMode || !entries.length) return setReply(null);
    let worker: Worker | undefined;
    const finish = (result: QueryReply) => {
      clearTimeout(limit);
      worker?.terminate();
      setReply({ ...result, expression });
    };
    const start = setTimeout(() => {
      worker = new Worker(new URL('../workers/query.worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<QueryReply>) => finish(event.data);
      worker.onerror = () => finish({ error: 'The query could not run.', paths: [], json: '' });
      worker.postMessage({ source, expression });
    }, 120);
    const limit = setTimeout(
      () =>
        finish({
          error: 'The query took too long and was stopped. Simplify the filter or pattern.',
          paths: [],
          json: '',
        }),
      5000,
    );
    return () => {
      clearTimeout(start);
      clearTimeout(limit);
      worker?.terminate();
    };
  }, [queryMode, expression, source, entries]);

  const queried = queryMode ? reply : null;
  const pending = queryMode && reply?.expression !== expression;
  /** The matching values, or null when nothing is being searched for. */
  const results = useMemo((): Entry[] | null => {
    if (!expression) return null;
    // A path selects one value (the last, when a key is repeated), so each path counts once and
    // every step lands on a match that can actually be shown.
    const unique = (list: Entry[]) => {
      const seen = new Set<string>();
      return list.filter((entry) => !seen.has(entry.path) && seen.add(entry.path));
    };
    if (queryMode)
      return unique(
        (queried?.paths ?? [])
          .map((path) => byPath.get(path))
          .filter((entry) => entry !== undefined),
      );
    return unique(entries.filter(matcher(expression)));
  }, [entries, expression, queryMode, queried, byPath, matcher]);
  const matches = useMemo(
    () => (results ? new Set(results.map((entry) => entry.path)) : null),
    [results],
  );
  const index = results ? results.findLastIndex((entry) => entry.path === active) : -1;

  /** Selects the next (or previous) result, wrapping around, starting from the first or last. */
  const step = useCallback(
    (direction: 1 | -1) => {
      if (!results?.length) return false;
      const count = results.length;
      const next =
        index < 0 ? (direction > 0 ? 0 : count - 1) : (index + direction + count) % count;
      return select(results[next].path);
    },
    [results, index, select],
  );

  const status =
    deferred !== query
      ? 'Searching…'
      : pending
        ? 'Running query…'
        : queried?.error
          ? queried.error
          : results
            ? `${index >= 0 ? `${(index + 1).toLocaleString()} of ` : ''}${results.length.toLocaleString()} ${queried ? 'query results' : 'matches'}`
            : '';

  return {
    query,
    setQuery,
    searching: query.trim() !== '',
    results,
    matches,
    index,
    step,
    status,
    error: queried?.error,
    /** The query's results as a JSON array, when it ran cleanly. */
    json: queried && !pending && !queried.error ? queried.json : null,
    /** The query this result list answers (settled, not mid-typing). */
    settled: pending || deferred !== query ? null : expression,
  };
}

export type SearchState = ReturnType<typeof useSearch>;
