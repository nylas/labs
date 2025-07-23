import { config } from "dotenv";
// Load environment variables from .env.local and .env files
config({ path: ".env.local" });
config({ path: ".env" });
import express, { Request, Response } from "express";
import { validateJWT } from "./middleware/jwt";

const app = express();
const port = 3999;

// Middleware to parse JSON
app.use(express.json());

// Public route
app.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "Clerk JWKS Demo App",
    endpoints: {
      "/validate-jwt": "POST - Test JWT validation (returns token info)",
      "/protected": "GET - Protected route (requires valid JWT)",
    },
    authentication: {
      cookie: "Include __session cookie for same-origin requests",
      header:
        "Include 'Authorization: Bearer <token>' for cross-origin requests",
    },
  });
});

// Test endpoint for JWT validation
app.post("/validate-jwt", validateJWT, (req: Request, res: Response) => {
  // If we reach here, the JWT is valid (middleware passed)
  res.json({
    success: true,
    message: "JWT is valid!",
    user: {
      id: req.user!.id,
      sessionId: req.user!.sessionId,
      email: req.user!.email || "demo@example.com",
      name: "Demo User",
    },
    tokenInfo: {
      validatedAt: new Date().toISOString(),
      tokenIssuer: req.user!.payload.iss,
      tokenSubject: req.user!.payload.sub,
      sessionId: req.user!.payload.sid,
      authorizedParty: req.user!.payload.azp,
      tokenExpiration: req.user!.payload.exp
        ? new Date((req.user!.payload.exp as number) * 1000).toISOString()
        : null,
      tokenNotBefore: req.user!.payload.nbf
        ? new Date((req.user!.payload.nbf as number) * 1000).toISOString()
        : null,
    },
  });
});

// Protected route example
app.get("/protected", validateJWT, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Access granted to protected resource!",
    user: {
      id: req.user!.id,
      sessionId: req.user!.sessionId,
      email: req.user!.email,
    },
    data: {
      secretMessage:
        "This is protected data that only authenticated users can see",
      timestamp: new Date().toISOString(),
    },
  });
});

app.listen(port, () => {
  console.log(`Server listening on port http://localhost:${port}`);
});
