#!/usr/bin/env node
/*
 * Re-embeds public/apple-touch-icon.png into index.html as a data URL.
 *
 * The touch icon is inline so iOS never has to fetch it — see the comment above the link in
 * index.html. Run this after regenerating the PNG, or the home screen keeps the old icon.
 */
import { readFileSync, writeFileSync } from "node:fs";

const png = readFileSync(new URL("../public/apple-touch-icon.png", import.meta.url));
const htmlUrl = new URL("../index.html", import.meta.url);
const html = readFileSync(htmlUrl, "utf8");
const pattern = /(<link rel="apple-touch-icon" href=")[^"]*(" \/>)/;
if (!pattern.test(html)) throw new Error("no apple-touch-icon link in index.html");
writeFileSync(htmlUrl, html.replace(pattern, `$1data:image/png;base64,${png.toString("base64")}$2`));
console.log(`embedded ${png.length} bytes`);
