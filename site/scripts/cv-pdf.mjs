// Prints the built /<lang>/cv/ pages to public/cv-ahmad-kassar-<lang>.pdf (A4), one per language.
// Needs Playwright with Chromium: npm install --no-save playwright && npx playwright install chromium
// Run after `npm run build`; then build again so the PDF is copied into dist/.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";
import { LANGS } from "../src/i18n/ui.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const server = await serve(0);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.emulateMedia({ media: "print", colorScheme: "light" });
  for (const lang of Object.keys(LANGS)) {
    await page.goto(`http://127.0.0.1:${server.address().port}/${lang}/cv/`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: path.join(ROOT, `public/cv-ahmad-kassar-${lang}.pdf`),
      format: "A4",
      margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" },
      printBackground: false,
    });
    process.stdout.write(`wrote public/cv-ahmad-kassar-${lang}.pdf\n`);
  }
} finally {
  await browser.close();
  server.close();
}
