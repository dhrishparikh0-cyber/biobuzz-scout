import { auth, ensureAuthSchema } from "../../auth.js";
import { toNodeHandler } from "better-auth/node";

const authHandler = toNodeHandler(auth);

export default async function handler(req, res) {
  try {
    await ensureAuthSchema();
    return authHandler(req, res);
  } catch (error) {
    console.error("Better Auth request failed:", error);
    return res.status(500).json({ error: "Authentication service unavailable." });
  }
}
