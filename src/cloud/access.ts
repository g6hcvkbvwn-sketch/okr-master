import { createRemoteJWKSet, jwtVerify } from "jose";

const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function hasAccess(request: Request, teamUrl?: string, audience?: string): Promise<boolean> {
  if (!teamUrl || !audience) {
    console.warn("Cloudflare Access is not configured.");
    return false;
  }
  let team: URL;
  try {
    team = new URL(teamUrl);
  } catch {
    console.warn("Cloudflare Access team URL is invalid.");
    return false;
  }
  if (
    team.protocol !== "https:" ||
    !team.hostname.endsWith(".cloudflareaccess.com") ||
    team.pathname !== "/" || team.search || team.hash || team.username || team.password || team.port
  ) {
    console.warn("Cloudflare Access team URL is invalid.");
    return false;
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  const issuer = team.origin;
  let keySet = keys.get(issuer);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    keys.set(issuer, keySet);
  }
  try {
    await jwtVerify(token, keySet, {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub"],
    });
    return true;
  } catch {
    console.warn("Cloudflare Access token verification failed.");
    return false;
  }
}
