import type { ReactNode } from 'react';
import type { ActionContext, Actions } from './actions';

export type OutputView = 'code' | 'tree' | 'table' | 'graph';

/** Everything the two document modes share: state, actions, and the reusable view panels. */
export interface AppContext extends ActionContext {
  /** A message after the source was replaced; offers Undo. */
  announce: (message: string) => void;
  actions: Actions;
  formatView: OutputView;
  setFormatView: (view: OutputView) => void;
  views: { explorer: ReactNode; graph: ReactNode; table: ReactNode };
}
