export function throttle(func: (...args: any[]) => void, wait: number) {
  let lastRun: number | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: any[]) => {
    const now = Date.now();

    if (lastRun && now < lastRun + wait) {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        lastRun = Date.now();
        func(...args);
      }, wait);
    } else {
      lastRun = now;
      func(...args);
    }
  };
}
