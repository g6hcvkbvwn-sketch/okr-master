import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type CloudEnvironment } from "./worker";

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare Access", () => {
  it("fails closed for missing or invalid access configuration before serving assets", async () => {
    const fetchAsset = vi.fn(async () => new Response("private"));
    const env: CloudEnvironment = {
      DB: { prepare: () => { throw new Error("Database must not be used."); } },
      ASSETS: { fetch: fetchAsset },
    };
    expect((await worker.fetch(new Request("https://okr.example/"), env)).status).toBe(403);
    env.ACCESS_TEAM_URL = "https://not-cloudflare.example";
    env.ACCESS_AUD = "audience";
    expect((await worker.fetch(new Request("https://okr.example/"), env)).status).toBe(403);
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("verifies the token signature, issuer, and audience before serving any asset", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const key = await exportJWK(publicKey);
    key.kid = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [key] })));
    const team = "https://test-okr.cloudflareaccess.com";
    const makeToken = (audience: string) => new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(team).setAudience(audience).setSubject("test-user")
      .setIssuedAt().setExpirationTime("5m").sign(privateKey);
    const env: CloudEnvironment = {
      DB: { prepare: () => { throw new Error("Database must not be used."); } },
      ASSETS: { fetch: async () => new Response("private") },
      ACCESS_TEAM_URL: team,
      ACCESS_AUD: "allowed",
    };
    const request = (token: string) => new Request("https://okr.example/app.js", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    expect((await worker.fetch(request(await makeToken("wrong")), env)).status).toBe(403);
    const authorized = await worker.fetch(request(await makeToken("allowed")), env);
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toBe("private");
    expect(authorized.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await worker.fetch(request("invalid"), env)).status).toBe(403);
  });
});
