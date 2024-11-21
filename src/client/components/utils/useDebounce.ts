import { useEffect, useState } from "hono/jsx/dom";
import { debounce } from "../../utils/debounce";

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = debounce(() => {
      setDebouncedValue(value);
    }, delay);

    handler();
  }, [value, delay]);

  return debouncedValue;
}
