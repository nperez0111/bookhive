import type {
  NodeSavedSession,
  NodeSavedSessionStore,
  NodeSavedState,
  NodeSavedStateStore,
} from "@atproto/oauth-client-node";
import type { Storage } from "unstorage";

export class StateStore implements NodeSavedStateStore {
  constructor(private kv: Storage) {}
  async get(key: string): Promise<NodeSavedState | undefined> {
    return (
      (await this.kv.get<NodeSavedState>(`auth_state:${key}`)) ?? undefined
    );
  }
  async set(key: string, val: NodeSavedState) {
    await this.kv.set(`auth_state:${key}`, val);
  }
  async del(key: string) {
    await this.kv.del(`auth_state:${key}`);
  }
}

export class SessionStore implements NodeSavedSessionStore {
  constructor(private kv: Storage) {}
  async get(key: string): Promise<NodeSavedSession | undefined> {
    return (
      (await this.kv.get<NodeSavedSession>(`auth_session:${key}`)) ?? undefined
    );
  }
  async set(key: string, val: NodeSavedSession) {
    await this.kv.set(`auth_session:${key}`, val);
  }
  async del(key: string) {
    await this.kv.del(`auth_session:${key}`);
  }
}
