// Sends an email for each newly-published post to all subscribed readers.
//
// Reuses Jekyll's own rendered HTML (from _site/, built by the workflow
// before this script runs) rather than re-parsing Markdown independently,
// so anything Jekyll-specific in a post - Liquid includes, the {% include
// image.html %} shortcode, kramdown extensions - renders identically in
// the email and on the site.
//
// Required env vars:
//   POST_FILES                  comma-separated paths to _posts/*.md files to send (relative to repo root)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   server-side key with SELECT access - never expose this in the site's JS
//   RESEND_API_KEY
//   FROM_EMAIL                  e.g. "Sports Grievances <newsletter@yourdomain.com>"
//   SITE_URL                    e.g. "https://yourusername.github.io/grievances-about-sports"
// Optional:
//   TEST_EMAIL                  if set, sends only to this address instead of querying Supabase
//   REPLY_TO                    address replies should go to (the sending domain can't receive mail)

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const RESEND_BATCH_LIMIT = 100;

// Mirrors assets/css/style.css's light-theme palette (--bg, --fg, --muted,
// --border, --accent) - email clients need inline styles, so this can't
// reference the stylesheet directly.
const COLOR_BG = "#fdfcfb";
const COLOR_FG = "#1a1a1a";
const COLOR_MUTED = "#6b6b6b";
const COLOR_BORDER = "#e5e0da";
const COLOR_ACCENT = "#c1440e";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Mirrors _config.yml's `permalink: /:year/:month/:day/:title/` against a
// standard Jekyll _posts/YYYY-MM-DD-title.md filename.
function postUrlPath(postFilePath) {
  const basename = path.basename(postFilePath, path.extname(postFilePath));
  const match = basename.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  if (!match) {
    throw new Error(`Post filename doesn't match YYYY-MM-DD-title.md: ${postFilePath}`);
  }
  const [, year, month, day, slug] = match;
  return `/${year}/${month}/${day}/${slug}/`;
}

// Rewrites root-relative src/href attributes (as Jekyll's relative_url filter
// produces, e.g. "/grievances-about-sports/assets/images/x.jpg") into fully
// qualified URLs, since email clients can't resolve relative links.
function absolutizeUrls(html, origin) {
  const $ = cheerio.load(html, null, false);
  $("[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src && src.startsWith("/")) $(el).attr("src", origin + src);
  });
  $("[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href && href.startsWith("/")) $(el).attr("href", origin + href);
  });
  return $.html();
}

function renderEmailHtml({ title, dateText, bodyHtml, postLink, unsubscribeLink }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${COLOR_BG};font-family:Georgia,'Times New Roman',serif;color:${COLOR_FG};">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <h1 style="font-size:1.6rem;margin-bottom:0;">${title}</h1>
      <p style="color:${COLOR_MUTED};font-family:-apple-system,sans-serif;font-size:0.9rem;margin-top:4px;">${dateText}</p>
      <div style="font-size:1.05rem;line-height:1.6;">${bodyHtml}</div>
      <p style="margin-top:32px;">
        <a href="${postLink}" style="color:${COLOR_ACCENT};">Read it on the site</a>
      </p>
      <hr style="margin:32px 0;border:none;border-top:1px solid ${COLOR_BORDER};">
      <p style="color:${COLOR_MUTED};font-family:-apple-system,sans-serif;font-size:0.8rem;">
        You're receiving this because you subscribed to Sports Grievances.
        <a href="${unsubscribeLink}" style="color:${COLOR_MUTED};">Unsubscribe</a>
      </p>
    </div>
  </body>
</html>`;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function getRecipients(supabase) {
  const testEmail = process.env.TEST_EMAIL;
  if (testEmail) {
    console.log(`TEST_EMAIL set - sending only to ${testEmail}`);
    return [{ email: testEmail, unsubscribe_token: "test" }];
  }

  const { data, error } = await supabase
    .from("subscribers")
    .select("email, unsubscribe_token")
    .eq("subscribed", true);

  if (error) {
    throw new Error(`Failed to fetch subscribers from Supabase: ${error.message}`);
  }
  return data;
}

async function sendPost(postFilePath, recipients, { resend, siteUrl, origin, fromEmail, replyTo }) {
  const { data: frontMatter } = matter(fs.readFileSync(postFilePath, "utf8"));
  const title = frontMatter.title || path.basename(postFilePath);
  const dateText = frontMatter.date
    ? new Date(frontMatter.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";

  const urlPath = postUrlPath(postFilePath);
  const builtHtmlPath = path.join("_site", urlPath, "index.html");
  if (!fs.existsSync(builtHtmlPath)) {
    throw new Error(`Built page not found at ${builtHtmlPath} - did "jekyll build" run before this script?`);
  }
  const $ = cheerio.load(fs.readFileSync(builtHtmlPath, "utf8"));
  const rawBodyHtml = $(".post-content").html();
  if (!rawBodyHtml) {
    throw new Error(`Couldn't find .post-content in ${builtHtmlPath}`);
  }
  const bodyHtml = absolutizeUrls(rawBodyHtml, origin);
  const postLink = siteUrl + urlPath;

  const emails = recipients.map((recipient) => ({
    from: fromEmail,
    to: recipient.email,
    ...(replyTo && { reply_to: replyTo }),
    subject: title,
    html: renderEmailHtml({
      title,
      dateText,
      bodyHtml,
      postLink,
      unsubscribeLink: `${siteUrl}/unsubscribe/?token=${recipient.unsubscribe_token}`,
    }),
  }));

  for (const batch of chunk(emails, RESEND_BATCH_LIMIT)) {
    const { error } = await resend.batch.send(batch);
    if (error) {
      throw new Error(`Resend batch send failed: ${JSON.stringify(error)}`);
    }
  }

  console.log(`Sent "${title}" to ${recipients.length} subscriber(s).`);
}

async function main() {
  const postFiles = requireEnv("POST_FILES")
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);

  if (postFiles.length === 0) {
    console.log("No new post files to send.");
    return;
  }

  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const resend = new Resend(requireEnv("RESEND_API_KEY"));
  const siteUrl = requireEnv("SITE_URL").replace(/\/$/, "");
  const origin = new URL(siteUrl).origin;
  const fromEmail = requireEnv("FROM_EMAIL");
  const replyTo = process.env.REPLY_TO;

  const recipients = await getRecipients(supabase);
  if (recipients.length === 0) {
    console.log("No subscribers to send to.");
    return;
  }

  for (const postFile of postFiles) {
    await sendPost(postFile, recipients, { resend, siteUrl, origin, fromEmail, replyTo });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
