# Grievances About Sports

A Substack-style newsletter: write a post as a Markdown file, push it to GitHub, and it's emailed to every subscriber automatically. The site itself is a static [Jekyll](https://jekyllrb.com/) site hosted on GitHub Pages.

## How it works

- **Site**: Jekyll, built automatically by GitHub Pages on every push to `main`.
- **Subscribers**: stored in a [Supabase](https://supabase.com) Postgres table, *not* in this repo. The signup form on the site talks to Supabase directly using a public "anon" key that can only insert new subscribers and call one narrow "unsubscribe" function — it can never read the subscriber list.
- **Sending email**: a GitHub Action (`.github/workflows/send-newsletter.yml`) runs on every push that adds a file under `_posts/`. It builds the site with Jekyll, reads that new post's actual rendered HTML (so anything Jekyll-specific — images, Liquid — matches the site exactly), reads the subscriber list from Supabase (using a private key only the Action has), and sends it via [Resend](https://resend.com).

## One-time setup

### 1. Supabase (subscriber storage)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates the `subscribers` table and locks it down with Row Level Security.
3. Go to **Project Settings → API** and note down:
   - **Project URL**
   - **anon / public key**
   - **service_role key** (keep this one secret — never put it in the site's JS or commit it)

### 2. Resend (sending email)

1. Create a free account at [resend.com](https://resend.com).
2. Create an API key.
3. Verify a sending domain under **Domains** (add the DNS records Resend gives you at your domain registrar), or use Resend's shared testing domain to start. Your "from" address needs to be on a verified domain before you can send to real subscribers.

### 3. Wire the keys up

**Public values** — edit [`_config.yml`](_config.yml) directly and commit:
- `supabase_url` → your Project URL
- `supabase_anon_key` → your anon/public key
- `url` / `baseurl` → your GitHub Pages URL once the repo is on GitHub

**Secrets** — in the GitHub repo, go to **Settings → Secrets and variables → Actions**:
- *Secrets* tab, add:
  - `SUPABASE_URL` (same Project URL as above)
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY`
- *Variables* tab, add:
  - `FROM_EMAIL` — e.g. `Grievances About Sports <newsletter@yourdomain.com>`
  - `SITE_URL` — e.g. `https://yourusername.github.io/grievances-about-sports` (no trailing slash)

### 4. Enable GitHub Pages

In the repo's **Settings → Pages**, set the source to the `main` branch (root). GitHub builds the Jekyll site automatically — no workflow needed for that part.

### 5. Owner notifications (optional)

Get an email at your own inbox whenever someone subscribes or unsubscribes. Subscribe/unsubscribe happen directly between the browser and Supabase (no server code in the loop), so this is a Supabase [Database Webhook](https://supabase.com/docs/guides/database/webhooks) on the `subscribers` table that calls a small Edge Function ([`supabase/functions/notify-owner`](supabase/functions/notify-owner)), which sends the notification via Resend.

1. Deploy the function (requires the [Supabase CLI](https://supabase.com/docs/guides/cli), logged in and linked to your project):
   ```bash
   supabase functions deploy notify-owner --no-verify-jwt
   ```
2. Set its secrets:
   ```bash
   supabase secrets set \
     RESEND_API_KEY=your_resend_api_key \
     NOTIFY_FROM_EMAIL="onboarding@resend.dev" \
     OWNER_EMAIL=you@example.com \
     WEBHOOK_SECRET=$(openssl rand -hex 32)
   ```
   (`NOTIFY_FROM_EMAIL` can stay on Resend's shared testing address until you verify your own domain — same as `FROM_EMAIL` in step 2.)
3. In the Supabase dashboard, go to **Database → Webhooks → Create a new webhook**:
   - Table: `subscribers`
   - Events: `Insert`, `Update`
   - Type: `HTTP Request` → `POST` to your function's URL (shown after deploy, looks like `https://<project-ref>.supabase.co/functions/v1/notify-owner`)
   - Add an HTTP header: `x-webhook-secret` → the same value you set for `WEBHOOK_SECRET` above

That's it — nothing in the site or the GitHub Action needs to change; this listens directly on the `subscribers` table. The `x-webhook-secret` header is checked on every request so the function can't be triggered by anyone who finds its URL.

## Writing and publishing a post

1. Add a new file to `_posts/`, named `YYYY-MM-DD-your-title.md`:
   ```markdown
   ---
   layout: post
   title: "Your Title Here"
   ---
   Your post content in Markdown.
   ```
2. Commit and push to `main`.
3. GitHub Pages rebuilds the site, and the "Send Newsletter" Action automatically emails every subscriber the new post.

### Adding images to a post

1. Drop the image file into `assets/images/`.
2. Reference it in the post with:
   ```liquid
   {% include image.html src="your-file.jpg" alt="Description for screen readers" caption="Optional caption text" %}
   ```
   (`caption` is optional — leave it off for a plain image.)

This renders as a responsive, captioned image on the site, and the same image (with a proper absolute URL) in the email.

### Editing an existing post

Editing a post file that's already been published — fixing a typo, tweaking wording — does **not** trigger a resend. The Action only fires for *newly added* files under `_posts/`; a push that only modifies an existing post file produces no output from the "which post(s) to send" step, so the send steps are skipped entirely. Just commit and push edits as normal.

## Local development (VS Code)

```bash
bundle install
bundle exec jekyll serve
```

Then open `http://localhost:4000`. Changes to most files live-reload automatically.

The subscribe/unsubscribe forms will talk to your real Supabase project even when running locally (they use the values from `_config.yml`), so you can test the full signup flow before publishing.

## Testing the email send without publishing

Go to the repo's **Actions → Send Newsletter → Run workflow**, and fill in:
- `post_file`: path to an existing post, e.g. `_posts/2026-08-31-welcome-to-grievances-about-sports.md`
- `test_email`: your own email address

This sends that post to just you, without touching the real subscriber list.
