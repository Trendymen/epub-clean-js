import { runLegacyStep } from '../cli.mjs';

await runLegacyStep(4).catch((error) => { console.error(error.message); process.exitCode = 1; });
