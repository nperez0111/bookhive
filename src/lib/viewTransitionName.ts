/** Stable CSS custom-ident, including spaces, punctuation and non-ASCII text. */
export function viewTransitionName(kind: string, value: string): string {
  return `${kind}-${Array.from(value, (character) => character.codePointAt(0)!.toString(16)).join("-")}`;
}
