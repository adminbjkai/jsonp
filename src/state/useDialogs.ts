import { useRef, type RefObject } from 'react';

const NAMES = ['help', 'palette', 'export', 'convert', 'schema', 'insights'] as const;
type DialogName = (typeof NAMES)[number];

/** The app's modal dialogs, opened by name from menus, shortcuts, and the command palette. */
export function useDialogs() {
  const refs: Record<DialogName, RefObject<HTMLDialogElement | null>> = {
    help: useRef(null),
    palette: useRef(null),
    export: useRef(null),
    convert: useRef(null),
    schema: useRef(null),
    insights: useRef(null),
  };
  const open = (name: DialogName) => refs[name].current?.showModal();
  const anyOpen = () => NAMES.some((name) => refs[name].current?.open);
  return { refs, open, anyOpen };
}

export type Dialogs = ReturnType<typeof useDialogs>;
