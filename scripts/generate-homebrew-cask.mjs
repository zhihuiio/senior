#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import process from "node:process";

function parseArgs(argv) {
  const args = { dmgPath: "", outPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dmg" && argv[index + 1]) {
      args.dmgPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--out" && argv[index + 1]) {
      args.outPath = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function sha256(filePath) {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function main() {
  const { dmgPath, outPath } = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const version = packageJson.version;
  const owner = packageJson.build?.publish?.[0]?.owner ?? "zhihuiio";
  const repo = packageJson.build?.publish?.[0]?.repo ?? packageJson.name;

  const resolvedDmgPath =
    dmgPath || join("release", `Senior-${version}-arm64.dmg`);
  const resolvedOutPath = outPath || join("release", "homebrew", "senior.rb");
  const checksum = sha256(resolvedDmgPath);
  const artifact = basename(resolvedDmgPath);
  const url = `https://github.com/${owner}/${repo}/releases/download/v${version}/${artifact}`;

  const cask = `cask "senior" do
  version "${version}"
  sha256 "${checksum}"

  url "${url}"
  name "Senior"
  desc "${packageJson.description}"
  homepage "${packageJson.homepage}"

  app "Senior.app"

  zap trash: [
    "~/Library/Application Support/Senior",
    "~/Library/Preferences/io.zhihui.senior.plist",
    "~/Library/Caches/io.zhihui.senior"
  ]
end
`;

  mkdirSync(join("release", "homebrew"), { recursive: true });
  writeFileSync(resolvedOutPath, cask, "utf8");
  process.stdout.write(`Generated ${resolvedOutPath}\n`);
}

main();
