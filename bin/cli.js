#!/usr/bin/env node
import path from "node:path";

const cmd = process.argv[2];
const argv = process.argv.slice(3);

const entries = {
  "strip":               "../src/entries/strip.js",
  "heal":                "../src/entries/heal.js",
  "align":               "../src/entries/align.js",
  "all":                 "../src/entries/all.js",
  "migrate-translation": "../src/entries/migrate-translation.js",
  "footnote-fix":        "../src/entries/footnote-fix.js",
  "lightnovel-html-to-epub": "../src/entries/lightnovel-html-to-epub.js",
  "lightnovel-html-simple-batch": "../src/entries/lightnovel-html-simple-batch.js",
  "build-yimei-simple": "../src/entries/lightnovel-html-simple-batch.js",
  "hyread-to-simple":            "../src/entries/hyread-to-simple.js",
};

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log("Usage: cli.js <subcommand> [options]\n\nSubcommands:");
  for (const k of Object.keys(entries)) console.log("  " + k);
  process.exit(0);
}

if (!entries[cmd]) {
  console.error(`Unknown subcommand: ${cmd}`);
  console.error(`Available: ${Object.keys(entries).join(", ")}`);
  process.exit(2);
}

const mod = path.resolve(import.meta.dirname, entries[cmd]);
process.argv = ["node", mod, ...argv];
await import(mod);
