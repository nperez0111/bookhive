import { resolve } from "path";
import { $ } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const APP_JSON = resolve(ROOT, "app.json");
const PACKAGE_JSON = resolve(ROOT, "package.json");

type ExpoConfig = {
  expo: {
    version: string;
    ios?: { buildNumber?: string };
    android?: { versionCode?: number };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type PackageJson = {
  version: string;
  [key: string]: unknown;
};

function parseSemver(v: string) {
  const [major, minor, patch] = v.split(".").map(Number);
  return { major, minor, patch };
}

function suggestBumps(current: string) {
  const { major, minor, patch } = parseSemver(current);
  return {
    patch: `${major}.${minor}.${patch + 1}`,
    minor: `${major}.${minor + 1}.0`,
    major: `${major + 1}.0.0`,
  };
}

async function main() {
  const appJson: ExpoConfig = await Bun.file(APP_JSON).json();
  const packageJson: PackageJson = await Bun.file(PACKAGE_JSON).json();

  const appVersion = appJson.expo.version;
  const pkgVersion = packageJson.version;
  const iosBuild = appJson.expo.ios?.buildNumber ?? "not set";
  const androidCode = appJson.expo.android?.versionCode ?? "not set";

  console.log(`\n  Current versions:\n`);
  console.log(`    app.json expo.version:   ${appVersion}`);
  console.log(`    package.json version:    ${pkgVersion}`);
  console.log(`    iOS buildNumber:         ${iosBuild}`);
  console.log(`    Android versionCode:     ${androidCode}\n`);

  const bumps = suggestBumps(appVersion);

  console.log(`  Suggestions (based on ${appVersion}):`);
  console.log(`    [p] patch:  ${bumps.patch}`);
  console.log(`    [m] minor:  ${bumps.minor}`);
  console.log(`    [M] major:  ${bumps.major}`);
  console.log(`    [enter]    keep ${appVersion} (just sync build numbers)\n`);

  process.stdout.write("  New version: ");

  let input = "";
  for await (const line of console) {
    input = line.trim().toLowerCase();
    break;
  }

  let newVersion: string;

  if (input === "") {
    newVersion = appVersion;
  } else if (input === "p" || input === "patch") {
    newVersion = bumps.patch;
  } else if (input === "m" || input === "minor") {
    newVersion = bumps.minor;
  } else if (input === "M" || input === "major") {
    newVersion = bumps.major;
  } else if (/^\d+\.\d+\.\d+$/.test(input)) {
    newVersion = input;
  } else {
    console.error(`\n  Invalid version: "${input}"`);
    process.exit(1);
  }

  const { major, minor, patch } = parseSemver(newVersion);
  const newIosBuild = `${major}${String(minor).padStart(2, "0")}${String(patch).padStart(2, "0")}`;
  const newAndroidCode = major * 10000 + minor * 100 + patch;

  const changed = newVersion !== appVersion;
  console.log(`\n  ${changed ? `Bumping to ${newVersion}` : `Keeping ${appVersion}`}\n`);
  console.log(`    iOS buildNumber:     ${iosBuild} → ${newIosBuild}`);
  console.log(`    Android versionCode: ${androidCode} → ${newAndroidCode}\n`);

  appJson.expo.version = newVersion;
  appJson.expo.ios = { ...appJson.expo.ios, buildNumber: newIosBuild };
  appJson.expo.android = { ...appJson.expo.android, versionCode: newAndroidCode };
  packageJson.version = newVersion;

  await Promise.all([
    Bun.write(APP_JSON, JSON.stringify(appJson, null, 2) + "\n"),
    Bun.write(PACKAGE_JSON, JSON.stringify(packageJson, null, 2) + "\n"),
  ]);

  if (changed) {
    await $`git add app.json package.json`.cwd(ROOT);
    await $`git commit -m ${`chore(release): version ${newVersion} of mobile app`}`.cwd(ROOT);
    console.log(`  Committed: chore(release): version ${newVersion} of mobile app\n`);
  }

  console.log("  Done ✓\n");
}

main();
