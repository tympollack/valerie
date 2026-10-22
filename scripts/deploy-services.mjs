#!/usr/bin/env node
/**
 * Project Valerie: Edge Functions & Cloudflare Worker Deployment Automation
 * File: scripts/deploy-services.mjs
 *
 * PURPOSE
 * -------
 * Automates one-command deployment of Valerie's distributed microservices:
 *   1. Supabase Edge Functions:
 *      - valerie-herald-agent (--no-verify-jwt)
 *      - valerie-cluster-engine (--no-verify-jwt)
 *      - simplify-word
 *   2. Cloudflare Cron Worker:
 *      - workers/valerie-herald-cron
 *
 * USAGE
 * -----
 *   node scripts/deploy-services.mjs [--project-ref=<REF>] [--dry-run] [--skip-worker] [--skip-edge]
 */

import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const WORKER_DIR = join(ROOT_DIR, "workers", "valerie-herald-cron");

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const skipWorker = args.includes("--skip-worker");
const skipEdge = args.includes("--skip-edge");

const projectRefArg = args.find((a) => a.startsWith("--project-ref="));
const projectRef =
  projectRefArg?.split("=")[1] ||
  process.env.SUPABASE_PROJECT_ID ||
  "rweehbzsflhhtwjrjnvy"; // Default to SunShade production/staging ref

// Enforce strict alphanumeric format to prevent shell metacharacter injection (SEC_0001)
if (!/^[a-z0-9_-]+$/i.test(projectRef)) {
  console.error(`❌ Invalid project reference format: "${projectRef}". Must contain only alphanumeric characters, dashes, and underscores.`);
  process.exit(1);
}

function resolveBinary(cmd) {
  if (process.platform === "win32") {
    return `${cmd}.cmd`;
  }
  return cmd;
}

function runCommand(command, cmdArgs, cwd = ROOT_DIR) {
  const display = `${command} ${cmdArgs.join(" ")}`;
  console.log(`\n==> Executing: ${display} (cwd: ${cwd})`);

  if (isDryRun) {
    console.log(`    [DRY RUN] Would execute: ${display}`);
    return true;
  }

  const bin = resolveBinary(command);
  const result = spawnSync(bin, cmdArgs, {
    cwd,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(`❌ Error launching ${command}:`, result.error.message);
    return false;
  }

  if (result.status !== 0) {
    console.error(`❌ Command failed with exit code ${result.status}`);
    return false;
  }

  console.log(`✅ Finished: ${display}`);
  return true;
}

console.log("================================================================================");
console.log("🚀 Project Valerie: Edge Functions & Cron Worker Deployer");
console.log(`   Target Project Ref: ${projectRef}`);
console.log(`   Dry Run: ${isDryRun ? "YES" : "NO"}`);
console.log("================================================================================");

let allSucceeded = true;

// 1. Deploy Supabase Edge Functions
if (!skipEdge) {
  console.log("\n📦 [1/2] Deploying Supabase Edge Functions...");

  const edgeFunctions = [
    { name: "valerie-herald-agent", flags: ["--no-verify-jwt"] },
    { name: "valerie-cluster-engine", flags: ["--no-verify-jwt"] },
    { name: "simplify-word", flags: [] },
  ];

  for (const fn of edgeFunctions) {
    const deployArgs = [
      "supabase",
      "functions",
      "deploy",
      fn.name,
      "--project-ref",
      projectRef,
      ...fn.flags,
    ];

    const ok = runCommand("npx", deployArgs, ROOT_DIR);
    if (!ok) {
      allSucceeded = false;
      console.warn(`⚠️  Warning: Failed to deploy ${fn.name}. Continuing with others...`);
    }
  }
} else {
  console.log("\n⏭️  Skipping Supabase Edge Functions (--skip-edge)");
}

// 2. Deploy Cloudflare Cron Worker
if (!skipWorker) {
  console.log("\n⚡ [2/2] Deploying Cloudflare Cron Worker (valerie-herald-cron)...");
  const heraldEndpoint = `https://${projectRef}.supabase.co/functions/v1/valerie-herald-agent`;
  const ok = runCommand(
    "npx",
    ["wrangler", "deploy", "--var", `HERALD_AGENT_ENDPOINT:${heraldEndpoint}`],
    WORKER_DIR
  );
  if (!ok) {
    allSucceeded = false;
    console.warn("⚠️  Warning: Failed to deploy Cloudflare Cron Worker.");
  }
} else {
  console.log("\n⏭️  Skipping Cloudflare Worker (--skip-worker)");
}

console.log("\n================================================================================");
if (allSucceeded) {
  console.log("🎉 All services deployed successfully!");
  console.log(`   Supabase Live URL: https://${projectRef}.supabase.co/functions/v1/valerie-herald-agent`);
} else {
  console.warn("⚠️  Some services failed to deploy. Review the logs above for details.");
  process.exitCode = 1;
}
console.log("================================================================================\n");
