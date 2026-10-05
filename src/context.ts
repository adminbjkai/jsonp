import type { ReactNode } from 'react';
import type { ActionContext, Actions } from './actions';
import type { SearchState } from './state/useSearch';

export type OutputView = 'code' | 'tree' | 'table' | 'graph';

/** Everything the two document modes share: state, actions, and the reusable view panels. */
export interface AppContext extends ActionContext {
  actions: Actions;
  search: SearchState;
  formatView: OutputView;
  setFormatView: (view: OutputView) => void;
  views: { explorer: ReactNode; graph: ReactNode; table: ReactNode };
}
