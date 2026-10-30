// Copies the static website (one level up) into worker/public so the Worker can serve it
// at bubble5.online. Runs automatically before `wrangler deploy` (see [build] in wrangler.toml).
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(here, "public");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ["index.html", "app.html", "help.html", "try.html", "robots.txt", "sitemap.xml"]) {
  if (!existsSync(join(root, f))) throw new Error("Missing " + f);
  cpSync(join(root, f), join(out, f));
}
cpSync(join(root, "assets"), join(out, "assets"), { recursive: true });
console.log("Site copied to", out);
