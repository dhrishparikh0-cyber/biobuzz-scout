import { auth, ensureAuthSchema } from "../../../../auth.js";
import { toNodeHandler } from "better-auth/node";

const authHandler = toNodeHandler(auth);

export default async function handler(req, res) {
  try {
    // Preserve the callback query string (state, code, scope, etc.)
    // while routing this explicit Vercel function to Better Auth.
    const url = new URL(req.url || "/", "http://localhost");
    req.url = `/api/auth/callback/google${url.search}`;
    await ensureAuthSchema();
    return authHandler(req, res);
  } catch (error) {
    console.error("Google OAuth callback failed:", error);
    return res.status(500).send("Google sign-in callback failed. Please try again.");
  }
}
