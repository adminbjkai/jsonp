import FindBar from './FindBar';
import PathBar from './PathBar';
import type { AppContext } from '../context';

/** Search and the selected value's path, shared by Format and Workspace. */
export default function LookupBar({ app }: { app: AppContext }) {
  const { doc, editor, io, search } = app;
  const { selected, input } = doc;
  return (
    <div className="lookup">
      <FindBar search={search} copy={io.copy} />
      <PathBar
        entry={selected}
        value={selected ? input.slice(selected.start, selected.end) : ''}
        select={editor.select}
        reveal={editor.reveal}
        copy={io.copy}
      />
    </div>
  );
}
