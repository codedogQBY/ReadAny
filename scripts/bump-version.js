#!/usr/bin/env node
/**
 * scripts/bump-version.js
 *
 * Usage:
 *   node scripts/bump-version.js 1.0.12      # Set version
 *   node scripts/bump-version.js --check      # Check consistency only
 *   node scripts/bump-version.js --prebuild   # Run pre-build checks
 *
 * Syncs version across:
 *   - packages/app/package.json
 *   - packages/app/src-tauri/tauri.conf.json
 *   - packages/app/src-tauri/Cargo.toml
 *   - packages/app-expo/package.json
 *   - packages/app-expo/app.json (expo.version)
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

const VERSION_FILES = [
  {
    path: "packages/app/package.json",
    read: (content) => JSON.parse(content).version,
    write: (content, version) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + "\n";
    },
  },
  {
    path: "packages/app/src-tauri/tauri.conf.json",
    read: (content) => JSON.parse(content).version,
    write: (content, version) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + "\n";
    },
  },
  {
    path: "packages/app/src-tauri/Cargo.toml",
    read: (content) => {
      const match = content.match(/^version = "([^"]+)"$/m);
      if (!match) {
        throw new Error("Could not find package version in Cargo.toml");
      }
      return match[1];
    },
    write: (content, version) => {
      if (!/^version = "([^"]+)"$/m.test(content)) {
        throw new Error("Could not find package version in Cargo.toml");
      }
      return content.replace(/^version = "[^"]+"$/m, `version = "${version}"`);
    },
  },
  {
    path: "packages/app-expo/package.json",
    read: (content) => JSON.parse(content).version,
    write: (content, version) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + "\n";
    },
  },
  {
    path: "packages/app-expo/app.json",
    read: (content) => JSON.parse(content).expo.version,
    write: (content, version) => {
      const json = JSON.parse(content);
      json.expo.version = version;
      return JSON.stringify(json, null, 2) + "\n";
    },
  },
];

function readVersions() {
  return VERSION_FILES.map((f) => {
    const fullPath = path.join(ROOT, f.path);
    const content = fs.readFileSync(fullPath, "utf8");
    return { file: f.path, version: f.read(content) };
  });
}

function checkConsistency() {
  const versions = readVersions();
  const unique = [...new Set(versions.map((v) => v.version))];

  console.log("Version check:");
  for (const v of versions) {
    console.log(`  ${v.file}: ${v.version}`);
  }

  if (unique.length !== 1) {
    console.error("\nERROR: Version mismatch detected!");
    process.exit(1);
  }

  console.log(`\nAll versions consistent: ${unique[0]}`);
  return unique[0];
}

function setVersion(newVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
    console.error(`Invalid version format: ${newVersion} (expected x.y.z)`);
    process.exit(1);
  }

  for (const f of VERSION_FILES) {
    const fullPath = path.join(ROOT, f.path);
    const content = fs.readFileSync(fullPath, "utf8");
    const updated = f.write(content, newVersion);
    fs.writeFileSync(fullPath, updated, "utf8");
    console.log(`  Updated ${f.path} -> ${newVersion}`);
  }

  console.log(`\nVersion bumped to ${newVersion}`);
}

function runPrebuildChecks() {
  console.log("\n🔍 Running pre-build checks...\n");

  console.log("1️⃣  Checking TypeScript compilation for packages/app...");
  try {
    execSync("pnpm exec tsc --noEmit", {
      cwd: path.join(ROOT, "packages/app"),
      stdio: "inherit",
    });
    console.log("   ✅ packages/app: TypeScript OK\n");
  } catch {
    console.error("   ❌ packages/app: TypeScript errors found!");
    process.exit(1);
  }

  console.log("2️⃣  Checking TypeScript compilation for packages/app-expo...");
  try {
    execSync("pnpm exec tsc --noEmit", {
      cwd: path.join(ROOT, "packages/app-expo"),
      stdio: "inherit",
    });
    console.log("   ✅ packages/app-expo: TypeScript OK\n");
  } catch {
    console.error("   ❌ packages/app-expo: TypeScript errors found!");
    process.exit(1);
  }

  console.log("3️⃣  Checking TypeScript compilation for packages/core...");
  try {
    execSync("pnpm exec tsc --noEmit", {
      cwd: path.join(ROOT, "packages/core"),
      stdio: "inherit",
    });
    console.log("   ✅ packages/core: TypeScript OK\n");
  } catch {
    console.error("   ❌ packages/core: TypeScript errors found!");
    process.exit(1);
  }

  console.log("4️⃣  Checking dependencies...");
  const pkgApp = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/app/package.json"), "utf8"));
  const pkgAppExpo = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages/app-expo/package.json"), "utf8"),
  );

  const depsToCheck = ["pdfjs-dist", "onnxruntime-node", "onnxruntime-web"];
  const missingDeps = [];

  for (const dep of depsToCheck) {
    if (pkgApp.dependencies?.[dep]) {
      const nodeModulesPath = path.join(ROOT, "node_modules", dep);
      if (!fs.existsSync(nodeModulesPath)) {
        missingDeps.push(`packages/app needs '${dep}' but not installed`);
      }
    }
    if (pkgAppExpo.dependencies?.[dep]) {
      const nodeModulesPath = path.join(ROOT, "node_modules", dep);
      if (!fs.existsSync(nodeModulesPath)) {
        missingDeps.push(`packages/app-expo needs '${dep}' but not installed`);
      }
    }
  }

  if (missingDeps.length > 0) {
    console.error("   ❌ Missing dependencies:");
    missingDeps.forEach((m) => console.error(`      - ${m}`));
    console.error("\n   Run 'pnpm install' in the root directory.");
    process.exit(1);
  }

  console.log("   ✅ All dependencies installed\n");

  console.log("✅ All pre-build checks passed!\n");
}

// Main
const arg = process.argv[2];

if (!arg) {
  console.log("Usage:");
  console.log("  node scripts/bump-version.js <version>   # Set version");
  console.log("  node scripts/bump-version.js --check     # Check consistency");
  console.log("  node scripts/bump-version.js --prebuild  # Run pre-build checks");
  process.exit(0);
}

if (arg === "--check") {
  checkConsistency();
} else if (arg === "--prebuild") {
  runPrebuildChecks();
  checkConsistency();
} else {
  runPrebuildChecks();
  setVersion(arg);
  checkConsistency();
}
