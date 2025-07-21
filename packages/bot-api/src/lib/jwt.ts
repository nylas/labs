import { SignJWT, jwtVerify } from "jose";
import { v4 as uuidv4 } from "uuid";
import { RedisStore } from "./redis";
import { logger } from "./logger";

export interface JwtPayload {
  sub: string; // grant:<grant_id>
  kid: string;
  iat: number;
  exp?: number;
  org: string;
  scp: string[]; // scopes
  [key: string]: unknown; // Index signature for compatibility
}

export async function signGrantJwt(
  grantId: string,
  orgId: string,
  ttlSeconds?: number,
  name?: string
): Promise<{ api_key: string; kid: string; expires_at?: number }> {
  try {
    logger.jwtOperation("sign", { grantId, orgId, ttl: ttlSeconds, name });

    const secret = await RedisStore.getJwtSecret();
    const secretBytes = new TextEncoder().encode(secret);

    const kid = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const exp = ttlSeconds ? now + ttlSeconds : undefined;

    const payload: JwtPayload = {
      sub: `grant:${grantId}`,
      kid,
      iat: now,
      org: orgId,
      scp: ["calendar.rw"],
    };

    if (exp) {
      payload.exp = exp;
    }

    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", kid })
      .sign(secretBytes);

    // Store the key in Redis
    await RedisStore.setKey(
      kid,
      {
        grant_id: grantId,
        name,
        created_at: now,
        expires_at: exp,
      },
      ttlSeconds
    );

    logger.jwtOperation("sign_success", { grantId, kid, exp });

    return {
      api_key: jwt,
      kid,
      expires_at: exp,
    };
  } catch (error) {
    logger.jwtError("sign", error, { grantId, orgId });
    throw new Error(
      `Failed to sign JWT for grant ${grantId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    logger.jwtOperation("verify", {
      token_prefix: token.substring(0, 20) + "...",
    });

    const secret = await RedisStore.getJwtSecret();
    const secretBytes = new TextEncoder().encode(secret);

    const { payload, protectedHeader } = await jwtVerify(token, secretBytes);

    const kid = protectedHeader.kid;
    if (!kid) {
      logger.jwtError("verify", new Error("Missing kid in JWT header"));
      return null;
    }

    // Check if key exists in Redis (for revocation)
    const keyExists = await RedisStore.keyExists(kid);
    if (!keyExists) {
      logger.jwtError("verify", new Error("JWT key not found in Redis"), {
        kid,
      });
      return null;
    }

    logger.jwtOperation("verify_success", { kid, sub: payload.sub });
    return payload as unknown as JwtPayload;
  } catch (error) {
    logger.jwtError("verify", error, {
      token_prefix: token.substring(0, 20) + "...",
    });
    return null;
  }
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
}
