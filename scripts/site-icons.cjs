// The app icons in another colour, for an extra site whose sites.json entry has "icon": "<name>":
// recolours production's coral icon.svg and favicon.svg and renders the PNGs and og-image.jpg from them
// into src/web/public/site-icons/<name>/, which the Worker serves in place of production's on that site.
// Usage (needs Playwright's Chromium): node scripts/site-icons.cjs <name> <light> <dark> <mountain>
//   e.g. node scripts/site-icons.cjs blue '#8db8ec' '#4a7fc4' '#22508c'
const fs = require("node:fs");
const { chromium } = require("playwright");
const pub = `${__dirname}/../src/web/public`;
const [name, light, dark, mount] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name || "") || !mount)
  throw new Error("usage: site-icons.cjs <name> <light> <dark> <mountain>");
const out = `${pub}/site-icons/${name}`;
fs.mkdirSync(out, { recursive: true });
const recolor = (s) => s.replaceAll("#e8a588", light).replaceAll("#c9785a", dark).replaceAll("#8f4630", mount);
const icon = recolor(fs.readFileSync(`${pub}/icon.svg`, "utf8"));
const square = icon.replace('<rect width="512" height="512" rx="112"/>', '<rect width="512" height="512"/>');
fs.writeFileSync(`${out}/icon.svg`, icon);
fs.writeFileSync(`${out}/favicon.svg`, recolor(fs.readFileSync(`${pub}/favicon.svg`, "utf8")));
(async () => {
  const b = await chromium.launch();
  const shot = async (svg, size, file, opts = {}) => {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(
      `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`,
    );
    await p.waitForTimeout(100);
    await p.screenshot({
      path: `${out}/${file}`,
      omitBackground: !opts.jpeg,
      type: opts.jpeg ? "jpeg" : "png",
      quality: opts.jpeg ? 90 : undefined,
    });
    await p.close();
  };
  await shot(icon, 192, "icon-192.png");
  await shot(icon, 512, "icon-512.png");
  await shot(square, 512, "icon-maskable-512.png");
  await shot(square, 180, "apple-touch-icon.png");
  await shot(square, 600, "og-image.jpg", { jpeg: true });
  await b.close();
})();
