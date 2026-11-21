import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { createAuthMiddleware, APIError } from "better-auth/api";
import pg from "pg";
import { Resend } from "resend";

const { Pool } = pg;
export const authPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
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

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export const auth = betterAuth({
  database: authPool,
  baseURL: process.env.BETTER_AUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173"),
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [
    "http://localhost:5173",
    "http://localhost:3000",
    ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : []),
  ],
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== "sign-in") return;
        if (!resend || !process.env.RESEND_FROM_EMAIL) {
          throw new Error("Email sign-in is not configured yet. Ask the BioBuzz Scout administrator to finish email setup.");
        }
        const result = await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: email,
          subject: "Your BioBuzz Scout sign-in code",
          text: `Your BioBuzz Scout sign-in code is ${otp}. It expires in 5 minutes. If you did not request this, you can ignore this email.`,
        });
        if (result.error) throw new Error("Could not send sign-in code.");
      },
    }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/email-otp/send-verification-otp" || ctx.path === "/sign-in/email-otp") {
        const email = String(ctx.body?.email || "").trim().toLowerCase();
        if (!roleForEmail(email)) {
          throw new APIError("FORBIDDEN", { message: "This email is not approved for BioBuzz Scout." });
        }
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!roleForEmail(user.email)) return false;
          return { data: user };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const result = await authPool.query('SELECT email FROM "user" WHERE id = $1 LIMIT 1', [session.userId]);
          if (!result.rows[0] || !roleForEmail(result.rows[0].email)) return false;
          return { data: session };
        },
      },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  telemetry: { enabled: false },
});
