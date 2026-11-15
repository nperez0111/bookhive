import { act, fireEvent } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

/**
 * Start native callbacks without awaiting their network/picker promise. RNTL 14
 * fireEvent waits for that promise; race tests must inspect state before settling
 * it. Passing several targets invokes them in the same render, before act flushes.
 */
export async function pressInFlight(...targets: TestInstance[]) {
  await eventInFlight("press", targets);
}

export async function submitInFlight(...targets: TestInstance[]) {
  await eventInFlight("submitEditing", targets);
}

async function eventInFlight(event: string, targets: TestInstance[]) {
  await act(() => {
    for (const target of targets) {
      void fireEvent(target, event);
    }
  });
}
