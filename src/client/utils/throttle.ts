export function throttle(func: (...args: any[]) => void, wait: number) {
  let lastRun: number | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: any[]) => {
    const now = Date.now();

    if (lastRun && now < lastRun + wait) {
      // If the function is being called before the wait period is over,
      // schedule it to run after the wait period
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        lastRun = Date.now();
        func(...args);
      }, wait);
    } else {
      // If enough time has passed, run the function immediately
      lastRun = now;
      func(...args);
    }
  };
}
