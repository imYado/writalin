/**
 * Sends login codes with Resend (https://resend.com). Set RESEND_API_KEY and
 * EMAIL_FROM in Vercel. Without a key (local dev), the code is printed to the
 * server log instead of being emailed.
 */
export async function sendLoginCode(email: string, code: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Writalin <login@writalin.app>";
  const subject = `${code} is your Writalin code`;
  const text = `Your Writalin code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1f2328">
<p>Your Writalin code is</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700;margin:12px 0">${code}</p>
<p style="color:#5f6368">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`;
  if (!key) {
    if (process.env.VERCEL_ENV === "production") throw new Error("RESEND_API_KEY is not set.");
    console.log(`[dev] Login code for ${email}: ${code}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject, text, html }),
  });
  if (!res.ok) throw new Error(`Email provider error ${res.status}: ${await res.text()}`);
}
