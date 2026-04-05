/**
 * Generates an ES256 private JWK for use as PRIVATE_KEY_JWK env var.
 * This key enables confidential OAuth client auth (private_key_jwt),
 * extending session lifetimes from 2 weeks to up to 180 days.
 *
 * Usage: bun run scripts/generate-jwk.ts
 */
import { generateClientAssertionKey } from "@atcute/oauth-node-client";

const jwk = await generateClientAssertionKey("main", "ES256");
console.log(`PRIVATE_KEY_JWK='${JSON.stringify(jwk)}'`);
