#!/usr/bin/env node
// Fails when a phone APK is over the size budget. In a workflow, the size
// also goes in the run's summary.
//
//   node scripts/apk-size.mjs <apk>

import { appendFileSync, statSync } from "node:fs";

// 25 MB as GitHub shows it, which is 25 MiB.
const APK_BUDGET_BYTES = 25 * 1024 * 1024;

const [apk] = process.argv.slice(2);
if (!apk) {
  console.error("Usage: node scripts/apk-size.mjs <apk>");
  process.exit(2);
}
const size = statSync(apk).size;
const line = `${apk}: ${size} bytes, budget ${APK_BUDGET_BYTES}`;
console.log(line);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
if (size > APK_BUDGET_BYTES) process.exit(1);
