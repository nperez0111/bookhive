import { isUsableHandle } from "../../bsky/id-resolver";

/** Readable user-facing URLs, without routing AppView placeholders as identities. */
export function actorLinkId(did: string, ...handles: (string | null | undefined)[]): string {
  return handles.find(isUsableHandle) ?? did;
}
