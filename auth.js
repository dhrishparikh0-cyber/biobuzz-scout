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
