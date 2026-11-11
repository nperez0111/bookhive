import { QueryClient, dehydrate } from "@tanstack/react-query";
import { shouldPersistQuery } from "../queryPersistence";

test("persists successful data but never sync passwords or opt-out queries", () => {
  const client = new QueryClient();
  client.setQueryData(["profile", "viewer"], { books: [] });
  client.setQueryData(["syncPassword"], { password: "secret" });
  client.setQueryDefaults(["private"], { meta: { persist: false } });
  client.setQueryData(["private"], "also secret");
  const saved = dehydrate(client, { shouldDehydrateQuery: shouldPersistQuery });
  expect(saved.queries.map((query) => query.queryKey)).toEqual([["profile", "viewer"]]);
  client.clear();
});
