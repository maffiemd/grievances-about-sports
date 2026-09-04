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

import { WELCOME_EMAIL_SUBJECT } from "./welcome-email.ts";
import { renderWelcomeEmailHtml } from "./render-welcome-email.ts";

function siteUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
}

async function sendEmail(
  to: string,
  subject: string,
  body: { text?: string; html?: string },
  replyTo?: string,
) {
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
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...body,
    }),
  });

  if (!res.ok) {
    console.error(`Resend send to ${to} failed:`, await res.text());
    return false;
  }
  return true;
}

interface Notification {
  to: string;
  subject: string;
  body: { text?: string; html?: string };
  replyTo?: string;
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
      {
        to: record.email,
        subject: WELCOME_EMAIL_SUBJECT,
        body: { html: renderWelcomeEmailHtml(siteUrl(), unsubscribeLink) },
        replyTo: ownerEmail,
      },
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

  const results = await Promise.all(notifications.map((n) => sendEmail(n.to, n.subject, n.body, n.replyTo)));

  if (results.some((ok) => !ok)) {
    return new Response("email send failed", { status: 502 });
  }

  return new Response("ok", { status: 200 });
});
