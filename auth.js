import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

const emails = (value, fallback) =>
  (value || fallback).split(",").map(x => x.trim().toLowerCase()).filter(Boolean);

export function roleForEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const mentors = emails(process.env.MENTOR_EMAILS, "mentor@example.com");
  const students = emails(process.env.STUDENT_EMAILS, "student@example.com");
  if (mentors.includes(normalized)) return "mentor";
  if (students.includes(normalized)) return "student";
  return null;
}

const baseURL =
  process.env.BETTER_AUTH_URL ||
  process.env.APP_ORIGIN ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  trustedOrigins: [process.env.APP_ORIGIN, process.env.BETTER_AUTH_URL].filter(Boolean),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      requireEmailVerification: true,
      prompt: "select_account",
    },
  },
  user: {
    validateUserInfo: ({ user }) => {
      if (!roleForEmail(user.email)) {
        return {
          error: "email_not_allowed",
          errorDescription: "This Google account is not approved for BioBuzz Scout.",
        };
      }
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!roleForEmail(user.email)) {
            throw new APIError("FORBIDDEN", {
              message: "This Google account is not approved for BioBuzz Scout.",
            });
          }
          return { data: user };
        },
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  telemetry: { enabled: false },
});

let migrationPromise;
export async function ensureAuthSchema() {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const { runMigrations } = await getMigrations(auth.options);
      await runMigrations();
    })().catch((error) => {
      migrationPromise = undefined;
      throw error;
    });
  }
  return migrationPromise;
}
