/**
 * Lazily evaluate a value.
 */
export function lazy<T>(getter: () => T): { value: T } {
  return {
    get value() {
      const value = getter();
      Object.defineProperty(this, "value", { value });
      return value;
    },
  };
}
