import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
const UnsavedContext = createContext<{
  register: (id: string, isDirty: () => boolean) => () => void;
} | null>(null);
export function UnsavedProvider({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, () => boolean>());
  const context = useMemo(
    () => ({
      register: (id: string, isDirty: () => boolean) => {
        drafts.current.set(id, isDirty);
        return () => {
          drafts.current.delete(id);
        };
      },
    }),
    [],
  );
  const hasUnsaved = () => [...drafts.current.values()].some((isDirty) => isDirty());
  useBeforeUnload((event) => {
    if (hasUnsaved()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const current = new URLSearchParams(currentLocation.search);
    current.delete('change');
    const next = new URLSearchParams(nextLocation.search);
    next.delete('change');
    return (
      hasUnsaved() &&
      (currentLocation.pathname !== nextLocation.pathname || current.toString() !== next.toString())
    );
  });
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (
        window.confirm(
          'Есть несохранённые правки. Покинуть экран? Черновик останется в этом браузере.',
        )
      )
        blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  return <UnsavedContext.Provider value={context}>{children}</UnsavedContext.Provider>;
}
export function useUnsavedChanges(dirty: boolean) {
  const context = useContext(UnsavedContext);
  const id = useId();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const navigationAllowed = useRef(false);
  useEffect(
    () => context?.register(id, () => dirtyRef.current && !navigationAllowed.current),
    [context, id],
  );
  return () => {
    navigationAllowed.current = true;
  };
}
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
