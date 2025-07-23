import { Request, Response, NextFunction } from "express";
import { jwtVerify, createRemoteJWKSet } from "jose";
import Cookies from "cookies";

// Clerk JWKS URL - with fallback to Backend API
const CLERK_FRONTEND_API = process.env.CLERK_FRONTEND_API;
console.log(`Using CLERK_FRONTEND_API: ${CLERK_FRONTEND_API}`);
const CLERK_JWKS_URL = `${CLERK_FRONTEND_API}/.well-known/jwks.json`;

console.log(`Using JWKS URL: ${CLERK_JWKS_URL}`);

// Create JWKS instance
const JWKS = createRemoteJWKSet(new URL(CLERK_JWKS_URL));

// Extend Request interface to include user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        sessionId: string;
        email?: string;
        payload: any;
      };
    }
  }
}

// JWT validation middleware
export const validateJWT = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve session token from either __session cookie (same-origin)
    // or Authorization header (cross-origin)
    const cookies = new Cookies(req, res);
    const sessionCookie = cookies.get("__session");

    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;

    const token = sessionCookie || authToken;

    if (!token) {
      return res.status(401).json({
        error: "Not signed in",
        message:
          "No session token found in __session cookie or Authorization header",
      });
    }

    // Verify the JWT using Clerk's JWKS
    const { payload } = await jwtVerify(token, JWKS, {
      algorithms: ["RS256"],
    });

    // Validate token's expiration (exp) and not before (nbf) claims
    const currentTime = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < currentTime) {
      throw new Error("Token is expired");
    }
    if (payload.nbf && payload.nbf > currentTime) {
      throw new Error("Token is not yet valid");
    }

    // // Validate the token's authorized party (azp) claim
    // if (payload.azp && !PERMITTED_ORIGINS.includes(payload.azp as string)) {
    //   throw new Error(`Invalid 'azp' claim: ${payload.azp}`);
    // }

    // Attach user data to request object
    req.user = {
      id: payload.sub as string,
      sessionId: payload.sid as string,
      email: payload.email as string,
      payload,
    };

    next();
  } catch (error) {
    console.error("JWT validation error:", error);
    res.status(401).json({
      error: "Invalid JWT token",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
