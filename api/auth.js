import { auth, ensureAuthSchema } from "../auth.js";
import { toNodeHandler } from "better-auth/node";

const authHandler = toNodeHandler(auth);

export default async function handler(req, res) {
  try {
    const incoming = new URL(req.url || "/api/auth", "http://localhost");
    const routedPath = incoming.searchParams.get("path");

    if (routedPath) {
      incoming.searchParams.delete("path");
      const cleanPath = routedPath.split("/").filter(Boolean).join("/");
      req.url = `/api/auth/${cleanPath}${incoming.search}`;
    } else if (!incoming.pathname.startsWith("/api/auth/")) {
      req.url = `/api/auth${incoming.pathname === "/api/auth" ? "" : incoming.pathname}${incoming.search}`;
    }

    await ensureAuthSchema();
    return authHandler(req, res);
  } catch (error) {
    console.error("Better Auth request failed:", error);
    return res.status(500).json({ error: "Authentication service unavailable." });
  }
}
