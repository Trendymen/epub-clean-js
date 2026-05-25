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

process.argv = ["node", entries[cmd], ...argv];
const mod = path.resolve(import.meta.dirname, entries[cmd]);
await import(mod);
