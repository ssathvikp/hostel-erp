"use client";

import { useCallback } from "react";

const PREFIX = "form:";

type PersistableElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Text-like fields only: never passwords, hidden fields or files. */
function isPersistable(element: Element): element is PersistableElement {
  if (element instanceof HTMLInputElement) {
    return (
      Boolean(element.name) && !["password", "hidden", "file", "submit"].includes(element.type)
    );
  }
  return (
    (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) &&
    Boolean(element.name)
  );
}

/**
 * Mirrors a form's unsaved input into sessionStorage, so refreshing the page
 * (or an accidental navigation) does not throw away what the user typed.
 * Storage is per browser tab and is never sent to the server.
 *
 * Returns a ref callback for the <form>. It re-attaches whenever the form
 * remounts (forms are keyed per server response), restoring saved input.
 */
export function usePersistedForm(key: string) {
  return useCallback(
    (form: HTMLFormElement | null) => {
      if (!form) return;
      const storageKey = `${PREFIX}${key}`;

      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const values = JSON.parse(saved) as Record<string, string>;
          for (const element of Array.from(form.elements)) {
            if (isPersistable(element) && element.name in values) {
              element.value = values[element.name] ?? "";
            }
          }
        }
      } catch {
        // Storage can be unavailable (private mode, quota); persistence is a nicety.
      }

      const save = () => {
        try {
          const values: Record<string, string> = {};
          for (const element of Array.from(form.elements)) {
            if (isPersistable(element)) values[element.name] = element.value;
          }
          sessionStorage.setItem(storageKey, JSON.stringify(values));
        } catch {
          // See above.
        }
      };

      form.addEventListener("input", save);
      form.addEventListener("change", save);
      return () => {
        form.removeEventListener("input", save);
        form.removeEventListener("change", save);
      };
    },
    [key],
  );
}

/** Forgets saved input once it has been stored on the server. */
export function clearPersistedForm(key: string) {
  try {
    sessionStorage.removeItem(`${PREFIX}${key}`);
  } catch {
    // Nothing to clear.
  }
}
