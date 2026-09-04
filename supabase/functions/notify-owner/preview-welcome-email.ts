// Renders the welcome email to a local HTML file so you can check it in a
// browser after editing welcome-email.ts, without deploying first. Run from
// the repo root:
//   deno task preview-welcome-email
// (shortcut defined in deno.json - or run the full command directly:
// deno run --allow-write supabase/functions/notify-owner/preview-welcome-email.ts)
// Then open the .preview.html file it writes (e.g. right-click it in VS
// Code's file explorer and choose Open Preview / Show Preview if you have
// the Live Preview extension, or just `open` it on macOS).

import { renderWelcomeEmailHtml } from "./render-welcome-email.ts";

const html = renderWelcomeEmailHtml("../../..", "#unsubscribe-link-placeholder");
const outPath = new URL("./.preview.html", import.meta.url).pathname;
await Deno.writeTextFile(outPath, html);
console.log(`Wrote ${outPath}`);
