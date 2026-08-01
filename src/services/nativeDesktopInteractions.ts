const COPY_ALLOWED_SELECTOR = "input,textarea,[contenteditable]:not([contenteditable='false']),[data-allow-copy]";

function elementFromEvent(event: Event): Element | null {
  return event.composedPath().find((entry): entry is Element => entry instanceof Element) ?? null;
}

export function isCopyAllowedTarget(target: Element | null): boolean {
  return Boolean(target?.closest(COPY_ALLOWED_SELECTOR));
}

/** WebView interaction polish only; this is not a data-protection boundary. */
export function installNativeDesktopInteractions(doc: Document = document): () => void {
  const preventWebContextMenu = (event: MouseEvent) => event.preventDefault();
  const preventDrag = (event: DragEvent) => event.preventDefault();
  const preventRestrictedSelection = (event: Event) => {
    const anchor = doc.getSelection()?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
    if (!isCopyAllowedTarget(elementFromEvent(event)) && !isCopyAllowedTarget(anchorElement)) {
      event.preventDefault();
    }
  };

  doc.addEventListener("contextmenu", preventWebContextMenu, true);
  doc.addEventListener("dragstart", preventDrag, true);
  doc.addEventListener("selectstart", preventRestrictedSelection, true);
  doc.addEventListener("copy", preventRestrictedSelection, true);

  return () => {
    doc.removeEventListener("contextmenu", preventWebContextMenu, true);
    doc.removeEventListener("dragstart", preventDrag, true);
    doc.removeEventListener("selectstart", preventRestrictedSelection, true);
    doc.removeEventListener("copy", preventRestrictedSelection, true);
  };
}
