import { Braces, ClipboardPaste, Upload } from 'lucide-react';
import SourceEditor from './SourceEditor';
import type { DocumentState } from '../state/useDocument';
import type { EditorState } from '../state/useEditor';

interface Props {
  doc: DocumentState;
  editor: EditorState;
  wrap: boolean;
  onOpen: () => void;
  onPaste: () => void;
  onSample: () => void;
}

/** The editable source, with first-step shortcuts while it is empty. */
export default function SourcePane({ doc, editor, wrap, onOpen, onPaste, onSample }: Props) {
  return (
    <>
      {!doc.input && (
        <div className="source-start">
          <button className="button" onClick={onOpen}>
            <Upload size={15} /> Open file
          </button>
          <button className="button" onClick={onPaste}>
            <ClipboardPaste size={15} /> Paste
          </button>
          <button className="button quiet" onClick={onSample}>
            <Braces size={15} /> Try the sample
          </button>
        </div>
      )}
      <SourceEditor
        ref={editor.inputRef}
        value={doc.input}
        wrap={wrap}
        errorLine={doc.problem?.line}
        onChange={doc.setInput}
        onCursor={editor.cursor}
      />
    </>
  );
}
