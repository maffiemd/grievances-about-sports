// Supabase Database Webhook target: emails the site owner whenever someone
// subscribes or unsubscribes. Subscribe/unsubscribe happen directly between
// the browser and this Supabase project (see assets/js/subscribe.js and
// unsubscribe.js) with no server code in the loop, so a Database Webhook on
// the `subscribers` table is the only reliable place to catch both events.
//
// One-time setup: see "Owner notifications" in the README.

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { type, record, old_record } = await req.json();

  let subject: string | null = null;
  if (type === "INSERT") {
    subject = `New subscriber: ${record.email}`;
  } else if (type === "UPDATE" && old_record?.subscribed === true && record?.subscribed === false) {
    subject = `Unsubscribed: ${record.email}`;
  }

  if (!subject) {
    // Some other change to the row (e.g. a future column) - not our concern.
    return new Response("ignored", { status: 200 });
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("NOTIFY_FROM_EMAIL"),
      to: Deno.env.get("OWNER_EMAIL"),
      subject,
      text: `${subject}\n\n${new Date().toUTCString()}`,
    }),
  });

  if (!res.ok) {
    console.error("Resend send failed:", await res.text());
    return new Response("email send failed", { status: 502 });
  }

  return new Response("ok", { status: 200 });
});
