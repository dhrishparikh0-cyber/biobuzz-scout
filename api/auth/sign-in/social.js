import { auth, ensureAuthSchema } from "../../../auth.js";
import { toNodeHandler } from "better-auth/node";

const authHandler = toNodeHandler(auth);

export default async function handler(req, res) {
  try {
    // This exact Vercel route exists specifically for Better Auth's
    // POST /api/auth/sign-in/social endpoint.
    req.url = "/api/auth/sign-in/social";
    await ensureAuthSchema();
    return authHandler(req, res);
  } catch (error) {
    console.error("Google sign-in endpoint failed:", error);
    return res.status(500).json({ error: "Google sign-in endpoint failed." });
  }
}
