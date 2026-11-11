import { act, fireEvent, render, screen } from "@testing-library/react-native";
import RegisterScreen from "@/app/(auth)/register";
import { createAuthSessionScope } from "@/context/authSession";

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const mockSession = createAuthSessionScope();
const mockSignup = jest.fn();
const mockSignIn = jest.fn();
const mockReplace = jest.fn();
let mockBlur: (() => void) | undefined;
jest.mock("@/context/auth", () => ({
  get authSession() {
    return mockSession;
  },
  useAuth: () => ({ signIn: mockSignIn }),
  getBaseUrl: () => "https://bookhive.test",
}));
jest.mock("ofetch", () => ({ ofetch: (...args: unknown[]) => mockSignup(...args) }));
jest.mock("expo-router", () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn() },
  useFocusEffect: (callback: () => () => void) => {
    const React = jest.requireActual<typeof import("react")>("react");
    React.useEffect(() => {
      mockBlur = callback();
      return mockBlur;
    }, [callback]);
  },
}));
jest.mock("@/hooks/useColorScheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "View" }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.replace(null);
  mockSignIn.mockResolvedValue("cancelled");
});
function fillAndSubmit(twice = false) {
  fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "reader@example.com");
  fireEvent.changeText(screen.getByPlaceholderText("yourname"), "reader");
  fireEvent.changeText(screen.getByPlaceholderText("At least 8 characters"), "password123");
  fireEvent.changeText(screen.getByPlaceholderText("Re-enter your password"), "password123");
  const input = screen.getByPlaceholderText("Re-enter your password");
  act(() => {
    fireEvent(input, "submitEditing");
    if (twice) fireEvent(input, "submitEditing");
  });
}

it("synchronously guards duplicate submissions and continues login after OAuth cancellation", async () => {
  const signup = deferred();
  mockSignup.mockReturnValue(signup.promise);
  render(<RegisterScreen />);
  fillAndSubmit(true);
  expect(mockSignup).toHaveBeenCalledTimes(1);
  await act(async () => signup.resolve({ success: true, handle: "reader.bookhive.social" }));
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: "/(auth)/login",
    params: { handle: "reader.bookhive.social" },
  });
});

it.each(["unmount", "blur", "session"])(
  "does not open OAuth after stale signup completion (%s)",
  async (reason) => {
    const signup = deferred();
    mockSignup.mockReturnValue(signup.promise);
    const view = render(<RegisterScreen />);
    fillAndSubmit();
    if (reason === "unmount") view.unmount();
    else if (reason === "blur") act(() => mockBlur?.());
    else act(() => mockSession.replace({ did: "did:plc:b", handle: "b.test", sid: "sid-b" }));
    await act(async () => signup.resolve({ success: true, handle: "reader.bookhive.social" }));
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  },
);

it("does not navigate after a superseded OAuth completion", async () => {
  mockSignup.mockResolvedValue({ success: true, handle: "reader.bookhive.social" });
  const oauth = deferred();
  mockSignIn.mockReturnValue(oauth.promise);
  render(<RegisterScreen />);
  fillAndSubmit();
  await act(async () => {});
  act(() => mockBlur?.());
  await act(async () => oauth.resolve("cancelled"));
  expect(mockReplace).not.toHaveBeenCalled();
});
