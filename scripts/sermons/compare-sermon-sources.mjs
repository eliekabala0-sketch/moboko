import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const oldDir = process.argv[2] || "C:\\Users\\user\\Downloads\\fichiers\\SERMONS\\CLEAN";
const rebuiltDir = process.argv[3] || join(root, "data", "sermons-rebuilt");

function normalize(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").trim();
}

function loose(value) {
  return normalize(value).replace(/\s+/g, " ");
}

function sha(value) {
  return createHash("sha256").update(normalize(value), "utf8").digest("hex");
}

function parse(path) {
  const paragraphs = [];
  let current = null;
  let parts = [];
  const flush = () => {
    if (current != null) paragraphs.push({ number: current, text: normalize(parts.join("\n")) });
    parts = [];
  };
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\[(\d+)\]\s*(.*)$/);
    if (match) {
      flush();
      current = Number(match[1]);
      parts.push(match[2]);
    } else if (current != null) parts.push(line);
  }
  flush();
  return paragraphs;
}

function main() {
  if (!existsSync(oldDir) || !existsSync(rebuiltDir)) throw new Error("Dossier source introuvable");
  const files = readdirSync(oldDir).filter((file) => file.toLowerCase().endsWith(".txt")).sort();
  const report = { generatedAt: new Date().toISOString(), oldDir, rebuiltDir, sermons: files.length, oldParagraphs: 0, rebuiltParagraphs: 0, affectedSermons: 0, affectedParagraphs: 0, expandedParagraphs: 0, shorterParagraphs: 0, missingParagraphs: 0, duplicateNumbers: 0, abnormalJumps: 0, examples: [] };
  for (const file of files) {
    const oldParagraphs = parse(join(oldDir, file));
    const rebuiltParagraphs = parse(join(rebuiltDir, file));
    report.oldParagraphs += oldParagraphs.length;
    report.rebuiltParagraphs += rebuiltParagraphs.length;
    const oldByNumber = new Map(oldParagraphs.map((paragraph) => [paragraph.number, paragraph]));
    const seen = new Set();
    const issues = [];
    for (let i = 0; i < rebuiltParagraphs.length; i += 1) {
      const paragraph = rebuiltParagraphs[i];
      if (seen.has(paragraph.number)) report.duplicateNumbers += 1;
      seen.add(paragraph.number);
      if (i > 0 && paragraph.number !== rebuiltParagraphs[i - 1].number + 1) report.abnormalJumps += 1;
      const old = oldByNumber.get(paragraph.number);
      if (!old) {
        report.missingParagraphs += 1;
        issues.push({ number: paragraph.number, type: "missing_old", rebuiltLength: loose(paragraph.text).length });
        continue;
      }
      if (sha(old.text) === sha(paragraph.text) || loose(old.text) === loose(paragraph.text)) continue;
      report.affectedParagraphs += 1;
      const before = loose(old.text);
      const after = loose(paragraph.text);
      const expanded = after.startsWith(before) && after.length > before.length;
      if (expanded) report.expandedParagraphs += 1;
      if (after.length < before.length) report.shorterParagraphs += 1;
      issues.push({ number: paragraph.number, type: expanded ? "expanded" : "changed", oldLength: before.length, rebuiltLength: after.length, oldTail: before.slice(-140), rebuiltTail: after.slice(-140) });
    }
    if (issues.length) {
      report.affectedSermons += 1;
      if (report.examples.length < 30) report.examples.push({ file, issues: issues.slice(0, 5) });
    }
  }
  const outDir = join(root, "scripts", "sermons", "reports");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `sermon-source-diff-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ ...report, examples: report.examples.length, outPath }, null, 2));
  if (report.shorterParagraphs || report.missingParagraphs || report.duplicateNumbers || report.abnormalJumps) process.exitCode = 2;
}

main();
