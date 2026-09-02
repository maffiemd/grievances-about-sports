// Supabase Database Webhook target: emails the site owner whenever someone
// subscribes, unsubscribes, or leaves a comment, and emails a new subscriber
// a welcome message. All these events happen directly between the browser
// and this Supabase project (see assets/js/subscribe.js, unsubscribe.js, and
// comments.js) with no server code in the loop, so a Database Webhook on the
// relevant table is the only reliable place to catch each event. Two
// webhooks point at this same function: one on `subscribers` (Insert,
// Update) and one on `comments` (Insert) - each webhook's own configuration
// is what tells us `table`, so it's trusted directly rather than guessed.
//
// The welcome email's copy lives in ./welcome-email.ts - edit that file to
// change what a new subscriber sees.
//
// One-time setup: see "Owner notifications" in the README.

import { WELCOME_EMAIL_BODY, WELCOME_EMAIL_SUBJECT } from "./welcome-email.ts";

// Mirrors assets/css/style.css's light-theme palette (--bg, --fg, --muted,
// --border) - email clients need inline styles, so this can't reference the
// stylesheet directly.
const COLOR_BG = "#fdfcfb";
const COLOR_FG = "#1a1a1a";
const COLOR_MUTED = "#6b6b6b";
const COLOR_BORDER = "#e5e0da";

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
  <body style="margin:0;padding:0;background:${COLOR_BG};font-family:Georgia,'Times New Roman',serif;color:${COLOR_FG};">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <h1 style="font-size:1.4rem;">${WELCOME_EMAIL_SUBJECT}</h1>
      <div style="font-size:1.05rem;line-height:1.6;">${paragraphs}</div>
      <hr style="margin:32px 0;border:none;border-top:1px solid ${COLOR_BORDER};">
      <p style="color:${COLOR_MUTED};font-family:-apple-system,sans-serif;font-size:0.8rem;">
        <a href="${unsubscribeLink}" style="color:${COLOR_MUTED};">Unsubscribe</a>
      </p>
    </div>
  </body>
</html>`;
}

interface Notification {
  to: string;
  subject: string;
  body: { text?: string; html?: string };
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// Figures out which email(s) a webhook event should trigger. Returns an
// empty array for events we don't care about (e.g. an unrelated column
// update) - the caller treats that as "ignored".
function buildNotifications(table: string, type: string, record: Row, oldRecord: Row | null): Notification[] {
  const ownerEmail = Deno.env.get("OWNER_EMAIL")!;
  const timestamped = (text: string) => `${text}\n\n${new Date().toUTCString()}`;

  if (table === "comments" && type === "INSERT") {
    const postUrl = siteUrl() ? siteUrl() + record.post_path : record.post_path;
    const subject = `New comment from ${record.author_name}`;
    const text = `${record.author_name} commented on ${postUrl}:\n\n"${record.body}"\n\nApprove it in the Supabase dashboard (Table Editor -> comments).`;
    return [{ to: ownerEmail, subject, body: { text: timestamped(text) } }];
  }

  if (table === "subscribers" && type === "INSERT") {
    const subject = `New subscriber: ${record.email}`;
    const unsubscribeLink = `${siteUrl()}/unsubscribe/?token=${record.unsubscribe_token}`;
    return [
      { to: ownerEmail, subject, body: { text: timestamped(subject) } },
      { to: record.email, subject: WELCOME_EMAIL_SUBJECT, body: { html: renderWelcomeEmailHtml(unsubscribeLink) } },
    ];
  }

  if (table === "subscribers" && type === "UPDATE" && oldRecord?.subscribed === true && record?.subscribed === false) {
    const subject = `Unsubscribed: ${record.email}`;
    return [{ to: ownerEmail, subject, body: { text: timestamped(subject) } }];
  }

  return [];
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { table, type, record, old_record } = await req.json();
  const notifications = buildNotifications(table, type, record, old_record ?? null);

  if (notifications.length === 0) {
    // Some other event (e.g. a future column update) - not our concern.
    return new Response("ignored", { status: 200 });
  }

  const results = await Promise.all(notifications.map((n) => sendEmail(n.to, n.subject, n.body)));

  if (results.some((ok) => !ok)) {
    return new Response("email send failed", { status: 502 });
  }

  return new Response("ok", { status: 200 });
});
