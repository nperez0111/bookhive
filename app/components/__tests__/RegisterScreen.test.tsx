import { submitInFlight } from "../../test/pressInFlight";
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
  useRouter: () => jest.requireMock("expo-router").router,
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
async function fillAndSubmit(twice = false) {
  await fireEvent.changeText(screen.getByPlaceholderText("you@example.com"), "reader@example.com");
  await fireEvent.changeText(screen.getByPlaceholderText("yourname"), "reader");
  await fireEvent.changeText(screen.getByPlaceholderText("At least 8 characters"), "password123");
  await fireEvent.changeText(screen.getByPlaceholderText("Re-enter your password"), "password123");
  const input = screen.getByPlaceholderText("Re-enter your password");
  await submitInFlight(...(twice ? [input, input] : [input]));
}

it("synchronously guards duplicate submissions and continues login after OAuth cancellation", async () => {
  const signup = deferred();
  mockSignup.mockReturnValue(signup.promise);
  await render(<RegisterScreen />);
  await fillAndSubmit(true);
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
    const view = await render(<RegisterScreen />);
    await fillAndSubmit();
    if (reason === "unmount") await view.unmount();
    else if (reason === "blur") await act(() => mockBlur?.());
    else await act(() => mockSession.replace({ did: "did:plc:b", handle: "b.test", sid: "sid-b" }));
    await act(async () => signup.resolve({ success: true, handle: "reader.bookhive.social" }));
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  },
);

it("does not navigate after a superseded OAuth completion", async () => {
  mockSignup.mockResolvedValue({ success: true, handle: "reader.bookhive.social" });
  const oauth = deferred();
  mockSignIn.mockReturnValue(oauth.promise);
  await render(<RegisterScreen />);
  await fillAndSubmit();
  await act(async () => {});
  await act(() => mockBlur?.());
  await act(async () => oauth.resolve("cancelled"));
  expect(mockReplace).not.toHaveBeenCalled();
});
