/**
 * JARVIS Sidecar Manager
 *
 * Manages trusted remote clients (mobile app, browser extension).
 * Uses ES256 JWT for authentication — keys stored in OS keychain.
 *
 * Sidecar flow:
 *   1. User registers a sidecar → daemon generates keypair, stores private in keychain
 *   2. Public key given to sidecar client
 *   3. Each request carries a JWT signed with the private key
 *   4. Daemon verifies with public key — no secret ever leaves the machine
 *
 * Logic inspired by usejarvis sidecar pattern — written fresh for our schema.
 */

import { SignJWT, jwtVerify, generateKeyPair, exportSPKI, exportPKCS8 } from "jose";
import { getDb, generateId, now } from "../vault/schema.ts";
import { storeKey, getKey } from "../config/keychain.ts";

const JWT_ISSUER = "jarvis-daemon";
const JWT_AUDIENCE = "jarvis-sidecar";
const KEY_ACCOUNT_PREFIX = "sidecar:privkey:";
const PUBKEY_ACCOUNT_PREFIX = "sidecar:pubkey:";

export interface SidecarInfo {
  id: string;
  name: string;
  publicKey: string;
  lastSeenAt: number | null;
  createdAt: number;
  active: boolean;
}

export class SidecarManager {
  /**
   * Register a new sidecar — generates keypair, stores in keychain.
   * Returns the public key to give to the client.
   */
  async register(name: string): Promise<{ sidecarId: string; publicKey: string }> {
    const { privateKey, publicKey } = await generateKeyPair("ES256");

    const privPem = await exportPKCS8(privateKey);
    const pubPem = await exportSPKI(publicKey);

    const sidecarId = generateId();

    // Store keys in OS keychain — never in SQLite
    await storeKey(`${KEY_ACCOUNT_PREFIX}${sidecarId}`, privPem);
    await storeKey(`${PUBKEY_ACCOUNT_PREFIX}${sidecarId}`, pubPem);

    // Record sidecar metadata in DB (no keys here)
    const db = getDb();
    db.run(
      `INSERT INTO sidecars(id,name,public_key_ref,created_at,active)
       VALUES(?,?,?,?,1)`,
      [sidecarId, name, `keychain:${PUBKEY_ACCOUNT_PREFIX}${sidecarId}`, now()]
    );

    return { sidecarId, publicKey: pubPem };
  }

  /**
   * Issue a JWT for a sidecar to use in requests.
   * The sidecar signs the JWT with its private key — this is what it sends.
   * (This method is for the daemon to generate test tokens; real clients sign their own.)
   */
  async issueToken(sidecarId: string, ttlSeconds = 3600): Promise<string> {
    const privPem = await getKey(`${KEY_ACCOUNT_PREFIX}${sidecarId}`);
    if (!privPem) throw new Error(`Sidecar ${sidecarId} not found in keychain`);

    const { createPrivateKey } = await import("node:crypto");
    const privateKey = createPrivateKey(privPem);

    return new SignJWT({ sid: sidecarId })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(privateKey as Parameters<SignJWT["sign"]>[0]);
  }

  /**
   * Verify an incoming JWT from a sidecar request.
   * Returns the sidecar ID if valid, throws if invalid.
   */
  async verify(token: string): Promise<{ sidecarId: string; name: string }> {
    // Decode without verifying first to get the sidecar ID
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    const sidecarId: string = payload.sid;

    if (!sidecarId) throw new Error("Token missing sidecar ID");

    const pubPem = await getKey(`${PUBKEY_ACCOUNT_PREFIX}${sidecarId}`);
    if (!pubPem) throw new Error(`Unknown sidecar: ${sidecarId}`);

    const { createPublicKey } = await import("node:crypto");
    const publicKey = createPublicKey(pubPem);

    await jwtVerify(token, publicKey as unknown as Parameters<typeof jwtVerify>[1], {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    // Update last seen
    const db = getDb();
    db.run(
      `UPDATE sidecars SET last_seen_at=? WHERE id=?`,
      [now(), sidecarId]
    );

    const row = db.query<{ name: string }, [string]>(
      `SELECT name FROM sidecars WHERE id=?`
    ).get(sidecarId);

    return { sidecarId, name: row?.name ?? "Unknown" };
  }

  list(): SidecarInfo[] {
    const db = getDb();
    return db.query<{
      id: string; name: string; last_seen_at: number | null; created_at: number; active: number;
    }, []>(
      `SELECT id,name,last_seen_at,created_at,active FROM sidecars ORDER BY created_at DESC`
    ).all().map(r => ({
      id: r.id,
      name: r.name,
      publicKey: "[stored in keychain]",
      lastSeenAt: r.last_seen_at,
      createdAt: r.created_at,
      active: r.active === 1,
    }));
  }

  revoke(sidecarId: string): void {
    const db = getDb();
    db.run(`UPDATE sidecars SET active=0 WHERE id=?`, [sidecarId]);
  }
}
