// Turns the copy in ./welcome-email.ts into the actual HTML email. Split out
// from index.ts so preview-welcome-email.ts can render it without booting
// the Edge Function (which needs Deno.env secrets index.ts doesn't have
// outside a deployed/linked environment).

import { WELCOME_EMAIL_BODY, WELCOME_EMAIL_SUBJECT } from "./welcome-email.ts";

// Mirrors assets/css/style.css's light-theme palette (--bg, --fg, --muted,
// --border) - email clients need inline styles, so this can't reference the
// stylesheet directly.
const COLOR_BG = "#fdfcfb";
const COLOR_FG = "#1a1a1a";
const COLOR_MUTED = "#6b6b6b";
const COLOR_BORDER = "#e5e0da";

export function renderWelcomeEmailHtml(siteUrl: string, unsubscribeLink: string) {
  const paragraphs = WELCOME_EMAIL_BODY.trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 1em;">${p.trim()}</p>`)
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${COLOR_BG};font-family:Georgia,'Times New Roman',serif;color:${COLOR_FG};">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <h1 style="font-size:1.4rem;">${WELCOME_EMAIL_SUBJECT}</h1>
      <img src="${siteUrl}/assets/images/festivus.jpg" alt="Seinfeld: the tradition of Festivus begins with the airing of grievances." style="max-width:100%;height:auto;display:block;border-radius:4px;margin:0 0 1.5em;">
      <div style="font-size:1.05rem;line-height:1.6;">${paragraphs}</div>
      <hr style="margin:32px 0;border:none;border-top:1px solid ${COLOR_BORDER};">
      <p style="color:${COLOR_MUTED};font-family:-apple-system,sans-serif;font-size:0.8rem;">
        <a href="${unsubscribeLink}" style="color:${COLOR_MUTED};">Unsubscribe</a>
      </p>
    </div>
  </body>
</html>`;
}
