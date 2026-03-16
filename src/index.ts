#!/usr/bin/env node

/**
 * Font Grabber CLI
 *
 * Interactive CLI tool that:
 * 1. Takes a website URL
 * 2. Discovers all fonts used on the page
 * 3. Lets the user select which fonts to download
 * 4. Downloads and converts them to TTF/OTF (preserving variable font data)
 *
 * Supports both interactive and non-interactive modes via CLI arguments.
 * Downloads go through a temporary cache directory that is cleaned up automatically.
 */

import { Command } from 'commander';
import { input, checkbox, confirm, Separator } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { discoverFonts } from './discovery.js';
import { downloadFontsToCache } from './downloader.js';
import { convertCachedFonts } from './converter.js';
import { anonymizeFont } from './anonymizer.js';
import type { DiscoveredFont, CachedFont, VariableAxis } from './types.js';

// ─── Constants ──────────────────────────────────────────────────────

const VERSION = '1.1.0';

const TOTAL_STEPS = 5;

/** Color palette for font family grouping */
const FAMILY_COLORS = [
  chalk.cyan,
  chalk.magenta,
  chalk.yellow,
  chalk.green,
  chalk.blue,
  chalk.red,
  chalk.white,
  chalk.hex('#FF9F43'),  // orange
  chalk.hex('#A29BFE'),  // lavender
  chalk.hex('#FD79A8'),  // pink
] as const;

// ─── Types ──────────────────────────────────────────────────────────

interface CLIOptions {
  output?: string;
  all?: boolean;
  anonymize?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────

function printBanner(): void {
  const line = chalk.dim('─'.repeat(52));
  console.log('');
  console.log(line);
  console.log('');
  console.log(chalk.bold.cyan('   ⬡  Font Grabber & Converter'));
  console.log('');
  console.log(chalk.dim('   Grab fonts from any website'));
  console.log(chalk.dim('   Convert to TTF/OTF · Variable fonts preserved'));
  console.log('');
  console.log(line);
  console.log('');
}

function step(n: number, label: string, total = TOTAL_STEPS): string {
  return `${chalk.dim(`[${n}/${total}]`)} ${label}`;
}

function formatWeight(weight: string): string {
  const weightNames: Record<string, string> = {
    '100': '100 (Thin)',
    '200': '200 (ExtraLight)',
    '300': '300 (Light)',
    '400': '400 (Regular)',
    '500': '500 (Medium)',
    '600': '600 (SemiBold)',
    '700': '700 (Bold)',
    '800': '800 (ExtraBold)',
    '900': '900 (Black)',
  };
  return weightNames[weight] || weight;
}

function formatAxes(axes: VariableAxis[]): string {
  return axes
    .map(a => `${a.name} (${a.tag}): ${a.min}–${a.max}, default ${a.default}`)
    .join('; ');
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Group fonts by family for better display.
 */
function groupByFamily(fonts: DiscoveredFont[]): Map<string, DiscoveredFont[]> {
  const groups = new Map<string, DiscoveredFont[]>();
  for (const font of fonts) {
    const existing = groups.get(font.family) || [];
    existing.push(font);
    groups.set(font.family, existing);
  }
  return groups;
}

/**
 * Assign a consistent color to each font family.
 */
function getFamilyColorMap(families: Map<string, DiscoveredFont[]>): Map<string, (text: string) => string> {
  const colorMap = new Map<string, (text: string) => string>();
  let i = 0;
  for (const family of families.keys()) {
    colorMap.set(family, FAMILY_COLORS[i % FAMILY_COLORS.length]);
    i++;
  }
  return colorMap;
}

/**
 * Extract domain from URL for default output directory.
 */
function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

// ─── Temp Cache Management ──────────────────────────────────────────

/**
 * Create a temporary cache directory for raw font downloads.
 * Returns the absolute path to the created directory.
 */
function createCacheDir(): string {
  const id = crypto.randomBytes(6).toString('hex');
  const cacheDir = path.join(os.tmpdir(), `font-grabber-${id}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

/**
 * Remove the temporary cache directory and all its contents.
 */
function cleanupCacheDir(cacheDir: string): void {
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    // Silently ignore cleanup errors — temp dir will be cleaned by OS eventually
  }
}

// ─── Display ────────────────────────────────────────────────────────

function displayFontTable(fonts: DiscoveredFont[]): void {
  const families = groupByFamily(fonts);
  const colorMap = getFamilyColorMap(families);

  const table = new Table({
    head: [
      chalk.bold.white('#'),
      chalk.bold.white('Family'),
      chalk.bold.white('Weight'),
      chalk.bold.white('Style'),
      chalk.bold.white('Format(s)'),
      chalk.bold.white('Variable'),
    ],
    style: { head: [], border: ['dim'] },
    chars: {
      'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
      'right': '│', 'right-mid': '┤', 'middle': '│',
    },
  });

  // Track previous family for visual grouping
  let prevFamily = '';

  fonts.forEach((font, idx) => {
    const colorFn = colorMap.get(font.family) || chalk.white;
    const formats = font.sources.map(s => s.format).join(', ');

    // Add separator row between families
    if (font.family !== prevFamily && prevFamily !== '') {
      table.push([{
        colSpan: 6,
        content: chalk.dim('─'.repeat(80)),
        hAlign: 'center',
      }]);
    }

    table.push([
      chalk.dim(String(idx + 1).padStart(2)),
      colorFn(font.family),
      formatWeight(font.weight),
      font.style,
      chalk.dim(formats),
      font.isVariable ? chalk.green('✓ Variable') : chalk.dim('Static'),
    ]);

    prevFamily = font.family;
  });

  console.log('');
  console.log(table.toString());

  // Summary line
  const familyCount = families.size;
  const variableCount = fonts.filter(f => f.isVariable).length;
  const staticCount = fonts.length - variableCount;

  const parts = [
    `${familyCount} famil${familyCount === 1 ? 'y' : 'ies'}`,
    `${fonts.length} variant${fonts.length === 1 ? '' : 's'}`,
  ];
  if (variableCount > 0) parts.push(chalk.green(`${variableCount} variable`));
  if (staticCount > 0) parts.push(`${staticCount} static`);

  console.log('');
  console.log(chalk.dim(`  ${parts.join('  ·  ')}`));
  console.log('');
}

/**
 * Build grouped checkbox choices with family separators.
 */
function buildGroupedChoices(fonts: DiscoveredFont[]) {
  const families = groupByFamily(fonts);
  const colorMap = getFamilyColorMap(families);
  const choices: Array<{ name: string; value: number; checked: boolean } | Separator> = [];

  let globalIdx = 0;

  for (const [family, members] of families) {
    const colorFn = colorMap.get(family) || chalk.white;

    // Family header separator
    const varLabel = members.some(f => f.isVariable) ? chalk.green(' [Variable]') : '';
    choices.push(
      new Separator(chalk.dim('───') + ' ' + colorFn(chalk.bold(family)) + varLabel + ' ' + chalk.dim(`(${members.length} variant${members.length === 1 ? '' : 's'})`) + ' ' + chalk.dim('───'))
    );

    for (const font of members) {
      choices.push({
        name: `  ${formatWeight(font.weight)} ${font.style}${font.isVariable ? chalk.green(' ✓') : ''}`,
        value: globalIdx,
        checked: true,
      });
      globalIdx++;
    }
  }

  return choices;
}

/**
 * Display confirmation summary before downloading.
 */
function displayConfirmation(fonts: DiscoveredFont[], outputDir: string): void {
  const families = groupByFamily(fonts);
  const colorMap = getFamilyColorMap(families);

  console.log('');
  console.log(chalk.bold('  Download Summary'));
  console.log(chalk.dim('  ─────────────────'));

  for (const [family, members] of families) {
    const colorFn = colorMap.get(family) || chalk.white;
    const weights = members.map(m => m.weight).join(', ');
    const varTag = members.some(m => m.isVariable) ? chalk.green(' [Variable]') : '';
    console.log(`  ${colorFn('●')} ${colorFn(family)}${varTag}  ${chalk.dim(weights)}`);
  }

  console.log('');
  console.log(`  ${chalk.dim('Fonts:')}    ${fonts.length} variant${fonts.length === 1 ? '' : 's'} from ${families.size} famil${families.size === 1 ? 'y' : 'ies'}`);
  console.log(`  ${chalk.dim('Output:')}   ${chalk.cyan(outputDir)}`);
  console.log(`  ${chalk.dim('Format:')}   TTF / OTF (auto-detected)`);
  console.log('');
}

/**
 * Display final results table.
 */
function displayResults(converted: Array<{ filename: string; outputFormat: string; variableAxesPreserved: boolean; axes?: VariableAxis[] }>, savedFiles: string[]): void {
  const table = new Table({
    head: [
      chalk.bold.white('File'),
      chalk.bold.white('Format'),
      chalk.bold.white('Size'),
      chalk.bold.white('Variable'),
      chalk.bold.white('Axes'),
    ],
    style: { head: [], border: ['dim'] },
    chars: {
      'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
      'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
      'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
      'right': '│', 'right-mid': '┤', 'middle': '│',
    },
    colWidths: [40, 8, 12, 12, 38],
    wordWrap: true,
  });

  let totalSize = 0;

  for (let i = 0; i < converted.length; i++) {
    const font = converted[i];
    const filePath = savedFiles[i];
    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;
    totalSize += fileSize;

    table.push([
      chalk.white(fileName),
      font.outputFormat.toUpperCase(),
      formatSize(fileSize),
      font.variableAxesPreserved ? chalk.green('✓ Yes') : chalk.dim('No'),
      font.axes ? formatAxes(font.axes) : chalk.dim('—'),
    ]);
  }

  console.log('');
  console.log(table.toString());

  // Total size
  console.log('');
  console.log(chalk.dim(`  Total: ${formatSize(totalSize)}`));
}

// ─── Process a single URL ───────────────────────────────────────────

async function processUrl(normalizedUrl: string, opts: CLIOptions): Promise<void> {
  // ── Step 2: Discover fonts ────────────────────────────────────────
  const spinner = ora({
    text: step(2, 'Discovering fonts...'),
    prefixText: '',
  }).start();

  let fonts: DiscoveredFont[];

  try {
    fonts = await discoverFonts(normalizedUrl, (msg) => {
      spinner.text = step(2, msg);
    });
    spinner.succeed(step(2, `Found ${chalk.bold(String(fonts.length))} font variant${fonts.length === 1 ? '' : 's'}`));
  } catch (err) {
    spinner.fail(step(2, 'Failed to discover fonts'));
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n  Error: ${message}`));
    return;
  }

  if (fonts.length === 0) {
    console.log('');
    console.log(chalk.yellow('  No downloadable fonts found on this page.'));
    console.log(chalk.dim('  The site may use system fonts, or fonts may be'));
    console.log(chalk.dim('  loaded in a way that cannot be detected.'));
    return;
  }

  // Display discovered fonts
  displayFontTable(fonts);

  // ── Step 3: Select fonts ──────────────────────────────────────────
  let selectedFonts: DiscoveredFont[];

  if (opts.all) {
    selectedFonts = fonts;
    console.log(step(3, `Selected all ${chalk.bold(String(fonts.length))} font${fonts.length === 1 ? '' : 's'} (--all)`));
    console.log('');
  } else {
    console.log(step(3, 'Select fonts'));
    console.log('');

    const choices = buildGroupedChoices(fonts);

    const selectedIndices = await checkbox<number>({
      message: 'Choose fonts to download:',
      choices,
      pageSize: 25,
      required: true,
      instructions: chalk.dim('  ↑↓ navigate · space toggle · a toggle all · enter confirm'),
    } as Parameters<typeof checkbox<number>>[0]);

    if (selectedIndices.length === 0) {
      console.log(chalk.yellow('\n  No fonts selected.'));
      return;
    }

    selectedFonts = selectedIndices.map(i => fonts[i]);
    console.log('');
    console.log(chalk.dim(`  Selected ${selectedFonts.length} of ${fonts.length} font variant${fonts.length === 1 ? '' : 's'}`));
    console.log('');

    // Prompt for anonymization if not already specified via flag
    if (opts.anonymize === undefined) {
      opts.anonymize = await confirm({
        message: 'Anonymize downloaded fonts?',
        default: false,
      });
      console.log('');
    }
  }

  // ── Output directory ──────────────────────────────────────────────
  const domain = extractDomain(normalizedUrl);
  const defaultDir = path.join(process.cwd(), 'fonts', domain);
  let outputDir: string;

  if (opts.output) {
    outputDir = path.resolve(opts.output);
  } else if (opts.all) {
    outputDir = defaultDir;
  } else {
    outputDir = await input({
      message: 'Output directory:',
      default: defaultDir,
    });
  }

  // ── Confirmation ──────────────────────────────────────────────────
  if (!opts.all) {
    displayConfirmation(selectedFonts, outputDir);

    const proceed = await confirm({
      message: 'Proceed with download?',
      default: true,
    });

    if (!proceed) {
      console.log(chalk.dim('\n  Cancelled.'));
      return;
    }

    console.log('');
  }

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // ── Step 4: Download to cache ─────────────────────────────────────
  const cacheDir = createCacheDir();

  try {
    const dlSpinner = ora({
      text: step(4, 'Downloading fonts...'),
    }).start();

    let cached: CachedFont[];
    const dlFailures: string[] = [];

    try {
      cached = await downloadFontsToCache(selectedFonts, cacheDir, 4, (completed, total, font) => {
        dlSpinner.text = step(4, `Downloading ${chalk.dim(`(${completed}/${total})`)} ${font.family}`);
      });

      const failedCount = selectedFonts.length - cached.length;
      if (failedCount > 0) {
        const cachedKeys = new Set(cached.map(c => c.info.key));
        for (const font of selectedFonts) {
          if (!cachedKeys.has(font.key)) {
            dlFailures.push(`${font.family} (${font.weight} ${font.style})`);
          }
        }
        dlSpinner.warn(step(4, `Downloaded ${cached.length}, ${chalk.yellow(`${failedCount} failed`)}`));
        for (const name of dlFailures) {
          console.log(chalk.yellow(`       ⚠ ${name}`));
        }
      } else {
        dlSpinner.succeed(step(4, `Downloaded ${chalk.bold(String(cached.length))} font${cached.length === 1 ? '' : 's'} ${chalk.dim('(cached)')}`));
      }
    } catch (err) {
      dlSpinner.fail(step(4, 'Download failed'));
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\n  Error: ${message}`));
      return;
    }

    // ── Step 5: Convert & Save ──────────────────────────────────────
    const cvSpinner = ora({
      text: step(5, 'Converting & saving...'),
    }).start();

    const cvFailures: string[] = [];
    const converted = await convertCachedFonts(cached, (completed, total, font, error) => {
      if (error) {
        const failedFont = cached[completed - 1];
        cvFailures.push(`${failedFont.info.family} (${failedFont.info.weight} ${failedFont.info.style}): ${error.message}`);
        cvSpinner.text = step(5, chalk.yellow(`Converting... error on ${failedFont.info.family}`));
      } else if (font) {
        cvSpinner.text = step(5, `Converting ${chalk.dim(`(${completed}/${total})`)} ${font.filename}`);
      }
    });

    if (converted.length === 0) {
      cvSpinner.fail(step(5, 'All conversions failed'));
      for (const name of cvFailures) {
        console.log(chalk.red(`       ✗ ${name}`));
      }
      return;
    }

    // Save files
    const savedFiles: string[] = [];

    for (const font of converted) {
      let filename = font.filename;
      let filePath = path.join(outputDir, filename);
      let counter = 1;
      while (fs.existsSync(filePath)) {
        const ext = path.extname(filename);
        const base = filename.slice(0, -ext.length);
        filePath = path.join(outputDir, `${base}-${counter}${ext}`);
        counter++;
      }

      fs.writeFileSync(filePath, font.data);

      if (opts.anonymize) {
        await anonymizeFont(filePath, filePath);
      }

      savedFiles.push(filePath);
    }

    if (cvFailures.length > 0) {
      cvSpinner.warn(step(5, `Saved ${converted.length} font${converted.length === 1 ? '' : 's'}, ${chalk.yellow(`${cvFailures.length} failed`)}`));
      for (const name of cvFailures) {
        console.log(chalk.yellow(`       ⚠ ${name}`));
      }
    } else {
      cvSpinner.succeed(step(5, `Saved ${chalk.bold(String(converted.length))} font${converted.length === 1 ? '' : 's'} to ${chalk.cyan(outputDir)}`));
    }

    // ── Step 6: Anonymize ───────────────────────────────────────────
    if (opts.anonymize) {
      const anonSpinner = ora({
        text: step(6, 'Anonymizing fonts...', 6),
      }).start();
      anonSpinner.succeed(step(6, `Anonymized ${chalk.bold(String(savedFiles.length))} font${savedFiles.length === 1 ? '' : 's'}`, 6));
    }

    // ── Results ─────────────────────────────────────────────────────
    displayResults(converted, savedFiles);

    // Variable font detail
    const variableFonts = converted.filter(f => f.variableAxesPreserved);
    if (variableFonts.length > 0) {
      console.log('');
      console.log(chalk.green(`  ${variableFonts.length} variable font${variableFonts.length === 1 ? '' : 's'} with axes preserved:`));
      for (const vf of variableFonts) {
        if (vf.axes && vf.axes.length > 0) {
          console.log(chalk.white(`    ${path.basename(vf.filename)}:`));
          for (const axis of vf.axes) {
            console.log(chalk.dim(`      ${axis.name} (${axis.tag}): ${axis.min} – ${axis.max} (default: ${axis.default})`));
          }
        }
      }
    }
  } finally {
    // Always clean up cache, even on error
    cleanupCacheDir(cacheDir);
  }
}

// ─── Main CLI Flow ──────────────────────────────────────────────────

async function run(urlArg: string | undefined, opts: CLIOptions): Promise<void> {
  const isInteractive = !urlArg || !opts.all;

  if (isInteractive) {
    printBanner();
  }

  // ── Step 1: Get URL ───────────────────────────────────────────────
  let normalizedUrl: string;

  if (urlArg) {
    normalizedUrl = urlArg.startsWith('http') ? urlArg : `https://${urlArg}`;
    if (!isValidUrl(normalizedUrl)) {
      console.error(chalk.red(`  Invalid URL: ${urlArg}`));
      process.exit(1);
    }
    if (isInteractive) {
      console.log(step(1, `URL: ${chalk.cyan(normalizedUrl)}`));
      console.log('');
    }
  } else {
    console.log(step(1, 'Enter URL'));
    console.log('');
    normalizedUrl = await promptForUrl();
    console.log('');
  }

  // Process first URL
  await processUrl(normalizedUrl, opts);

  console.log('');
  console.log(chalk.green.bold('  ✓ Done!'));
  console.log('');

  // ── Multi-URL loop (interactive only) ─────────────────────────────
  if (isInteractive) {
    while (true) {
      const another = await confirm({
        message: 'Scan another URL?',
        default: false,
      });

      if (!another) break;

      console.log('');
      console.log(chalk.dim('─'.repeat(52)));
      console.log('');
      console.log(step(1, 'Enter URL'));
      console.log('');

      const nextUrl = await promptForUrl();
      console.log('');

      await processUrl(nextUrl, { ...opts, output: undefined });

      console.log('');
      console.log(chalk.green.bold('  ✓ Done!'));
      console.log('');
    }
  }

  console.log(chalk.dim('  Goodbye!'));
  console.log('');
}

/**
 * Prompt the user for a website URL.
 */
async function promptForUrl(): Promise<string> {
  const url = await input({
    message: 'Website URL:',
    validate: (value) => {
      const testUrl = value.startsWith('http') ? value : `https://${value}`;
      return isValidUrl(testUrl) || 'Please enter a valid URL (e.g., https://example.com)';
    },
    transformer: (value) => {
      if (value && !value.startsWith('http')) {
        return chalk.dim('https://') + value;
      }
      return value;
    },
  });
  return url.startsWith('http') ? url : `https://${url}`;
}

// ─── CLI Setup ──────────────────────────────────────────────────────

const program = new Command();

program
  .name('font-grabber')
  .description('Grab fonts from any website and convert to TTF/OTF')
  .version(VERSION, '-v, --version')
  .argument('[url]', 'website URL to grab fonts from')
  .option('-o, --output <dir>', 'output directory for downloaded fonts')
  .option('-a, --all', 'download all fonts without prompting for selection')
  .option('-n, --anonymize', 'Anonymize downloaded fonts (remove metadata)')
  .action(async (url: string | undefined, opts: CLIOptions) => {
    await run(url, opts);
  });

// ─── anonymize subcommand ────────────────────────────────────────────

interface AnonymizeOptions {
  output?: string;
}

program
  .command('anonymize')
  .description('Anonymize a local font file by stripping identifying metadata')
  .argument('<file>', 'path to the TTF/OTF font file to anonymize')
  .option('-o, --output <file>', 'output file path (default: <filename>-anon<ext> next to the original)')
  .action(async (file: string, opts: AnonymizeOptions) => {
    const inputPath = path.resolve(file);

    if (!fs.existsSync(inputPath)) {
      console.error(chalk.red(`  Error: file not found: ${inputPath}`));
      process.exit(1);
    }

    // Derive default output path: <basename>-anon<ext>
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    const dir = path.dirname(inputPath);
    const outputPath = opts.output
      ? path.resolve(opts.output)
      : path.join(dir, `${base}-anon${ext}`);

    const spinner = ora({
      text: `Anonymizing ${chalk.cyan(path.basename(inputPath))}...`,
    }).start();

    try {
      await anonymizeFont(inputPath, outputPath);
      spinner.succeed(
        `Anonymized ${chalk.cyan(path.basename(inputPath))} → ${chalk.green(path.basename(outputPath))}` +
        chalk.dim(` (${path.dirname(outputPath)})`),
      );
      console.log('');
    } catch (err) {
      spinner.fail(chalk.red('Anonymization failed'));
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\n  Error: ${message}`));
      process.exit(1);
    }
  });

program.parse();
