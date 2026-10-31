#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolveHyreadConfig } from './config.mjs';
import { prepareSession, loadSession } from './lib/session.mjs';
import { createBrowserScript } from './lib/browser-script.mjs';
import { receiveChunk, finalizeTransfer } from './lib/transfer.mjs';
import { buildHyreadEpub } from './lib/build.mjs';
import { verifyHyreadEpub } from './lib/verify.mjs';
import { writeVerificationReports, exportSemanticMaterial } from './lib/reports.mjs';
import { validateCapture, validateAuditEnvelope, resourceHref } from './lib/artifacts.mjs';
import { safeJoin, writeFileAtomic } from './lib/paths.mjs';

const usage = {
  prepare: '--volume <number> --asset-id <id> --title <title> [--work-dir <dir>]',
  'browser-script': '--session <session.json> --mode <capture|audit>',
  receive: '--session <session.json> --info <info.json> --chunk <chunk.json>',
  finalize: '--session <session.json> --info <info.json> [--replace]',
  build: '--session <session.json> [--out <book.epub>] [--replace]',
  verify: '--session <session.json> --epub <book.epub> [--audit <audit.json>] [--require-live] [--report <report.json>]',
  'semantic-export': '--session <session.json> --audit <audit.json> --out-dir <dir>',
};
const required = {
  prepare: ['volume', 'asset-id', 'title'], 'browser-script': ['session', 'mode'],
  receive: ['session', 'info', 'chunk'], finalize: ['session', 'info'], build: ['session'],
  verify: ['session', 'epub'], 'semantic-export': ['session', 'audit', 'out-dir'],
};
const booleanOptions = new Set(['replace', 'require-live']);
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const printJson = (value) => console.log(JSON.stringify(value, null, 2));

function optionsFor(args, allowed, needed = []) {
  const options = Object.fromEntries(allowed.map((name) => [name, { type: booleanOptions.has(name) ? 'boolean' : 'string' }]));
  options.help = { type: 'boolean', short: 'h' };
  const { values } = parseArgs({ args, options, allowPositionals: false, strict: true });
  if (!values.help) for (const name of needed) if (typeof values[name] !== 'string' || !values[name].trim()) throw new Error(`Missing --${name}`);
  for (const [name, value] of Object.entries(values)) if (typeof value === 'string' && !value.trim()) throw new Error(`Empty --${name}`);
  return values;
}

function bookOptions(values) {
  return { volume: values.volume, assetId: values['asset-id'], title: values.title, workDir: values['work-dir'] };
}

export async function runHyreadCli(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') {
    if (rest.length) throw new Error('Unexpected arguments after help');
    console.log('用法：node hyread/cli.mjs <command> [options]\n');
    for (const [name, flags] of Object.entries(usage)) console.log(`  ${name} ${flags}`);
    return;
  }
  if (!Object.hasOwn(usage, command)) throw new Error(`Unknown HyRead command: ${command}`);
  const allowed = [...usage[command].matchAll(/--([a-z-]+)/g)].map((match) => match[1]);
  const values = optionsFor(rest, allowed, required[command]);
  if (values.help) { console.log(`用法：node hyread/cli.mjs ${command} ${usage[command]}`); return; }
  if (command === 'prepare') {
    const { config, session } = await prepareSession(resolveHyreadConfig(bookOptions(values)));
    printJson({ sessionPath: config.sessionPath, resourcesDir: config.resourcesDir, session }); return;
  }
  const { config, session } = await loadSession(resolve(values.session), { outputPath: values.out && resolve(values.out) });
  switch (command) {
    case 'browser-script':
      process.stdout.write(await createBrowserScript(session, { mode: values.mode })); break;
    case 'receive':
      printJson(await receiveChunk(config, await readJson(values.info), await readJson(values.chunk))); break;
    case 'finalize':
      printJson(await finalizeTransfer(config, await readJson(values.info), { replace: values.replace })); break;
    case 'build':
      printJson(await buildHyreadEpub(config, { replace: values.replace })); break;
    case 'verify': {
      const capture = await readJson(config.capturePath);
      const audit = values.audit ? await readJson(values.audit) : undefined;
      const report = await verifyHyreadEpub({ config, session, capture, audit, epubPath: resolve(values.epub), requireLive: values['require-live'] });
      const reportPath = values.report ? resolve(values.report) : join(config.workDir, 'reports', `verify-${Date.now()}-${randomUUID()}.json`);
      const paths = await writeVerificationReports(report, reportPath);
      printJson({ report, ...paths });
      if (!report.ok) process.exitCode = 1;
      break;
    }
    case 'semantic-export': {
      const audit = validateAuditEnvelope(await readJson(values.audit), session);
      printJson(await exportSemanticMaterial(audit, resolve(values['out-dir']))); break;
    }
  }
}

export async function runLegacyStep(step, args = process.argv.slice(2)) {
  const common = ['session', 'volume', 'asset-id', 'title', 'work-dir'];
  const values = optionsFor(args, [...common, ...(step === 2 ? [] : ['replace']), ...(step === 4 ? ['out'] : [])]);
  if (values.help) {
    console.log(`用法：node hyread/scripts/${step}-*.mjs [--session <session.json> | --volume <number> --asset-id <id> --title <title> [--work-dir <dir>]]${step === 4 ? ' [--out <book.epub>] [--replace]' : step === 3 ? ' [--replace]' : ''}`); return;
  }
  const explicit = ['volume', 'asset-id', 'title'].some((key) => values[key] !== undefined);
  if (values.session && (explicit || values['work-dir'])) throw new Error('--session cannot be combined with book configuration');
  if (explicit) for (const name of ['volume', 'asset-id', 'title']) if (!values[name]) throw new Error(`Missing --${name}`);
  const initial = resolveHyreadConfig({ ...bookOptions(values), outputPath: values.out && resolve(values.out) });
  if (step === 2 && !values.session) {
    const { config, session } = await prepareSession(initial);
    printJson({ sessionPath: config.sessionPath, session }); return;
  }
  const loaded = await loadSession(values.session ? resolve(values.session) : initial.sessionPath, { outputPath: values.out && resolve(values.out) });
  if (!values.session && (loaded.session.volume !== initial.volume || loaded.session.assetId !== initial.assetId || loaded.session.title !== initial.bookTitle)) throw new Error('Configuration belongs to another prepared session');
  const { config, session } = loaded;
  if (step === 2) {
    const prepared = await prepareSession(config); printJson({ sessionPath: prepared.config.sessionPath, session: prepared.session });
  } else if (step === 4) printJson(await buildHyreadEpub(config, { replace: values.replace }));
  else if (step === 3) {
    const capture = validateCapture(await readJson(config.capturePath), session);
    const pending = [];
    for (const src of capture.order) {
      const path = await safeJoin(config.workDir, `decrypted/${resourceHref(src, session)}`), bytes = Buffer.from(capture.data[src]);
      if (!values.replace) {
        try { if (!(await readFile(path)).equals(bytes)) throw new Error(`Existing file differs: ${path}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      pending.push({ path, bytes });
    }
    for (const item of pending) await writeFileAtomic(item.path, item.bytes, { replace: values.replace });
    printJson({ directory: join(config.workDir, 'decrypted'), files: pending.length });
  } else throw new Error(`Unknown legacy step: ${step}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runHyreadCli().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
