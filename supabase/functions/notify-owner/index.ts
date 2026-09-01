// Supabase Database Webhook target: emails the site owner whenever someone
// subscribes, unsubscribes, or leaves a comment, and emails a new subscriber
// a welcome message. All these events happen directly between the browser
// and this Supabase project (see assets/js/subscribe.js, unsubscribe.js, and
// comments.js) with no server code in the loop, so a Database Webhook on the
// relevant table is the only reliable place to catch each event. Two
// webhooks point at this same function: one on `subscribers` (Insert,
// Update) and one on `comments` (Insert).
//
// The welcome email's copy lives in ./welcome-email.ts - edit that file to
// change what a new subscriber sees.
//
// One-time setup: see "Owner notifications" in the README.

import { WELCOME_EMAIL_BODY, WELCOME_EMAIL_SUBJECT } from "./welcome-email.ts";

function siteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
}

async function sendEmail(to: string, subject: string, body: { text?: string; html?: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("NOTIFY_FROM_EMAIL"),
      to,
      subject,
      ...body,
    }),
  });

  if (!res.ok) {
    console.error(`Resend send to ${to} failed:`, await res.text());
    return false;
  }
  return true;
}

function renderWelcomeEmailHtml(unsubscribeLink: string) {
  const paragraphs = WELCOME_EMAIL_BODY.trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 1em;">${p.trim()}</p>`)
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fdfcfb;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <h1 style="font-size:1.4rem;">${WELCOME_EMAIL_SUBJECT}</h1>
      <div style="font-size:1.05rem;line-height:1.6;">${paragraphs}</div>
      <hr style="margin:32px 0;border:none;border-top:1px solid #e5e0da;">
      <p style="color:#6b6b6b;font-family:-apple-system,sans-serif;font-size:0.8rem;">
        <a href="${unsubscribeLink}" style="color:#6b6b6b;">Unsubscribe</a>
      </p>
    </div>
  </body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { table, type, record, old_record } = await req.json();
  // Fall back to the row shape if `table` isn't present, for robustness.
  const isComment = table === "comments" || (!table && "author_name" in (record ?? {}));

  let subject: string | null = null;
  let text = "";

  if (isComment && type === "INSERT") {
    const postUrl = siteUrl() ? siteUrl() + record.post_path : record.post_path;
    subject = `New comment from ${record.author_name}`;
    text = `${record.author_name} commented on ${postUrl}:\n\n"${record.body}"\n\nApprove it in the Supabase dashboard (Table Editor -> comments).`;
  } else if (!isComment && type === "INSERT") {
    subject = `New subscriber: ${record.email}`;
    text = subject;
  } else if (!isComment && type === "UPDATE" && old_record?.subscribed === true && record?.subscribed === false) {
    subject = `Unsubscribed: ${record.email}`;
    text = subject;
  }

  if (!subject) {
    // Some other change to a row (e.g. a future column) - not our concern.
    return new Response("ignored", { status: 200 });
  }

  const ownerOk = await sendEmail(Deno.env.get("OWNER_EMAIL")!, subject, {
    text: `${text}\n\n${new Date().toUTCString()}`,
  });

  let welcomeOk = true;
  if (!isComment && type === "INSERT") {
    const unsubscribeLink = `${siteUrl()}/unsubscribe/?token=${record.unsubscribe_token}`;
    welcomeOk = await sendEmail(record.email, WELCOME_EMAIL_SUBJECT, {
      html: renderWelcomeEmailHtml(unsubscribeLink),
    });
  }

  if (!ownerOk || !welcomeOk) {
    return new Response("email send failed", { status: 502 });
  }

  return new Response("ok", { status: 200 });
});
