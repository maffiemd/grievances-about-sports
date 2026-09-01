// Supabase Database Webhook target: emails the site owner whenever someone
// subscribes, unsubscribes, or leaves a comment. All three happen directly
// between the browser and this Supabase project (see assets/js/subscribe.js,
// unsubscribe.js, and comments.js) with no server code in the loop, so a
// Database Webhook on the relevant table is the only reliable place to catch
// each event. Two webhooks point at this same function: one on `subscribers`
// (Insert, Update) and one on `comments` (Insert).
//
// One-time setup: see "Owner notifications" in the README.

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
    const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const postUrl = siteUrl ? siteUrl + record.post_path : record.post_path;
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
      text: `${text}\n\n${new Date().toUTCString()}`,
    }),
  });

  if (!res.ok) {
    console.error("Resend send failed:", await res.text());
    return new Response("email send failed", { status: 502 });
  }

  return new Response("ok", { status: 200 });
});
