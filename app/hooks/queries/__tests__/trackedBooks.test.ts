import { QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, authSession } from "@/context/auth";
import { useUpdateComment } from "../trackedBooks";

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: jest.fn(),
  useMutation: jest.fn((options) => options),
}));
jest.mock("@/utils/bookMutations", () => ({}));
jest.mock("@/context/auth", () => {
  const { createAuthSessionScope } = jest.requireActual("@/context/authSession");
  const session = createAuthSessionScope();
  const network = jest.fn();
  return {
    authSession: session,
    authFetch: network,
    createSessionFetch: () => {
      const captured = session.capture();
      return async (...args: unknown[]) => {
        captured.assertCurrent();
        const body = await network(...args);
        captured.assertCurrent();
        return body;
      };
    },
  };
});

test("comment application failures reject instead of displaying success", async () => {
  authSession.replace({ did: "did:plc:a", handle: "a.test", sid: "a" });
  const client = new QueryClient();
  (useQueryClient as jest.Mock).mockReturnValue(client);
  useUpdateComment();
  const options = (useMutation as jest.Mock).mock.calls.at(-1)![0];
  (authFetch as jest.Mock).mockResolvedValue({ success: false, message: "PDS write failed" });
  await expect(options.mutationFn({ hiveId: "bk_one", comment: "Hello" })).rejects.toThrow(
    "PDS write failed",
  );
  expect(authFetch).toHaveBeenCalledWith(
    "/api/update-comment",
    expect.objectContaining({ retry: 0 }),
  );
  const invalidate = jest.spyOn(client, "invalidateQueries");
  authSession.replace(null);
  options.onSuccess({ success: true }, { hiveId: "bk_one" });
  expect(invalidate).not.toHaveBeenCalled();
  client.clear();
});
