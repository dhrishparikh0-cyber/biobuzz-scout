# BioBuzz Scout — authentication and deployment setup

## Access rules

BioBuzz Scout accepts only emails in the approved allowlists.

- Mentor: can view and edit every scouting report.
- Student: can view every scouting report, but can edit only reports they created.
- Any other email: blocked from sign-in and from all scouting API routes.

The example defaults are `mentor@example.com` and `student@example.com`. Replace them with real approved addresses before inviting anyone. Multiple addresses are comma-separated.

## Vercel environment variables

Open the BioBuzz Scout project in Vercel → Settings → Environment Variables. Add each variable for Production and Preview:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Neon Postgres connection string |
| `BETTER_AUTH_SECRET` | A long random secret (at least 32 characters) |
| `BETTER_AUTH_URL` | Your production app URL, e.g. `https://your-project.vercel.app` |
| `APP_ORIGIN` | Same production app URL |
| `MENTOR_EMAILS` | Comma-separated approved mentor emails |
| `STUDENT_EMAILS` | Comma-separated approved student emails |
| `RESEND_API_KEY` | Your Resend API key |
| `RESEND_FROM_EMAIL` | A sender address verified with Resend |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret |

Never put secrets in frontend code or commit them to GitHub. Add the database URL, auth secret, Resend key, and Google secret as Sensitive values.

### Updating the approved email lists

Only edit these two variables in Vercel:

- Add mentors to `MENTOR_EMAILS`, separated by commas.
- Add students to `STUDENT_EMAILS`, separated by commas.

Example:
`MENTOR_EMAILS=mentor1@school.edu,mentor2@school.edu`
`STUDENT_EMAILS=student1@school.edu,student2@school.edu`

If an email appears in both lists, mentor access takes priority. After changing variables, redeploy the project so the server picks up the new values.

## Email-code login

Email-code login uses Resend. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` to send the 6-digit, five-minute sign-in code. The sender address/domain must be verified with Resend.

## Google login

Create a Google OAuth web application and set its authorized redirect URI to:

`https://YOUR-APP-DOMAIN/api/auth/callback/google`

Then add the generated client ID and secret to Vercel. Google sign-in is enabled only when both values are configured.

## Database

The Better Auth tables and `created_by_email` ownership column have already been created in the connected Neon database. Do not delete these tables. Existing scouting reports created before ownership tracking have no owner; they remain visible to everyone and are editable by mentors only.

## Deployment status

The code is pushed to the GitHub `main` branch. A Vercel project still needs to be linked to that repository before the app is live. Once Vercel's GitHub Login Connection is connected, link `dhrishparikh0-cyber/biobuzz-scout` to the Vercel team and add the environment variables above.
