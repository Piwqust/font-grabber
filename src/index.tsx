#!/usr/bin/env node

/**
 * Font Grabber CLI - OpenTUI React version
 */

import { Command } from 'commander';
import React, { useState, useEffect } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, useRenderer } from '@opentui/react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { discoverFonts } from './discovery.js';
import { downloadFontsToCache } from './downloader.js';
import { convertCachedFonts } from './converter.js';
import { anonymizeFont } from './anonymizer.js';
import type { DiscoveredFont, CachedFont, VariableAxis } from './types.js';

const VERSION = '1.1.0';

// ─── Helpers ──────────────────────────────────────────────────────────

const WEIGHT_NAMES: Record<string, string> = {
  '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular',
  '500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black',
};

function formatVariant(weight: string, style: string): string {
  const name = WEIGHT_NAMES[weight] ?? weight;
  const w = name !== weight ? `${weight} ${name}` : weight;
  if (style === 'italic') return `${w} Italic`;
  if (style !== 'normal' && style !== 'regular') return `${w} ${style}`;
  return w;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

function extractDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function sanitizeFamilyDir(family: string): string {
  return family
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function createCacheDir(): string {
  const id = crypto.randomBytes(6).toString('hex');
  const dir = path.join(os.tmpdir(), `font-grabber-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupCacheDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

// ─── App Component ──────────────────────────────────────────────────

function App({ initialUrl, opts }: { initialUrl?: string; opts: any }) {
  const renderer = useRenderer();

  const [step, setStep] = useState<"input" | "discovering" | "selection" | "output_dir" | "processing" | "results">("input");
  
  const [url, setUrl] = useState(initialUrl || "");
  const [fonts, setFonts] = useState<DiscoveredFont[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  
  const [outputDir, setOutputDir] = useState("");
  const [progressMsg, setProgressMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  
  const [finalResults, setFinalResults] = useState<{
    converted: any[];
    savedFiles: string[];
    failures: string[];
  }>({ converted: [], savedFiles: [], failures: [] });

  useKeyboard((key) => {
    if ((key.ctrl && key.name === "c") || key.name === "escape") {
      renderer.destroy();
      process.exit(0);
    }
  });

  // Skip URL input if provided and valid
  useEffect(() => {
    if (step === "input" && initialUrl && isValidUrl(initialUrl)) {
      startDiscovery(initialUrl);
    }
  }, []);

  const startDiscovery = async (targetUrl: string) => {
    setStep("discovering");
    setErrorMsg("");
    
    let normalized = targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`;
    if (!isValidUrl(normalized)) {
      setErrorMsg("Invalid URL. Please include http:// or https://");
      setStep("input");
      return;
    }
    
    setUrl(normalized);

    try {
      const discovered = await discoverFonts(normalized, (msg) => {
        setProgressMsg(msg);
      });
      
      setFonts(discovered);
      
      if (discovered.length === 0) {
        setErrorMsg("No fonts found on this page.");
        setStep("input");
        return;
      }
      
      if (opts.all) {
        setSelectedIndices(new Set(discovered.map((_, i) => i)));
        // Auto proceed to output dir
        const domain = extractDomain(normalized);
        const defaultDir = path.join(process.cwd(), 'fonts', domain);
        if (opts.output) {
          startProcessing(discovered, new Set(discovered.map((_, i) => i)), opts.output);
        } else {
          setOutputDir(defaultDir);
          setStep("output_dir");
        }
      } else {
        // Select all by default
        setSelectedIndices(new Set(discovered.map((_, i) => i)));
        setStep("selection");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("input");
    }
  };

  const startProcessing = async (targetFonts: DiscoveredFont[], indices: Set<number>, targetDir: string) => {
    setStep("processing");
    const selectedFonts = targetFonts.filter((_, i) => indices.has(i));
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const cacheDir = createCacheDir();
    const failures: string[] = [];
    
    try {
      // 1. Download
      setProgressMsg("Downloading fonts...");
      const cached = await downloadFontsToCache(selectedFonts, cacheDir, 4, (completed, total, font) => {
        setProgressMsg(`Downloading: ${completed}/${total} - ${font.family}`);
      });
      
      // 2. Convert
      setProgressMsg("Converting fonts...");
      const converted = await convertCachedFonts(cached, (completed, total, font, error) => {
        if (error) {
          const f = cached[completed - 1];
          failures.push(`Convert error on ${f.info.family}: ${error.message}`);
        } else if (font) {
          setProgressMsg(`Converting: ${completed}/${total} - ${font.filename}`);
        }
      });
      
      // 3. Save & Anonymize
      const savedFiles: string[] = [];
      for (const font of converted) {
        const familyDir = sanitizeFamilyDir(font.info.family);
        const familyPath = path.join(targetDir, familyDir);
        if (!fs.existsSync(familyPath)) fs.mkdirSync(familyPath, { recursive: true });

        let filename = font.filename;
        let filePath = path.join(familyPath, filename);
        let counter = 1;
        while (fs.existsSync(filePath)) {
          const ext = path.extname(filename);
          const base = filename.slice(0, -ext.length);
          filePath = path.join(familyPath, `${base}-${counter}${ext}`);
          counter++;
        }

        fs.writeFileSync(filePath, font.data);

        if (opts.anonymize) {
          try {
            setProgressMsg(`Anonymizing: ${filename}`);
            await anonymizeFont(filePath, filePath);
          } catch (err) {
            failures.push(`Anonymize error on ${filename}`);
          }
        }
        savedFiles.push(filePath);
      }
      
      setFinalResults({ converted, savedFiles, failures });
      setStep("results");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("results"); // Show error on results page
    } finally {
      cleanupCacheDir(cacheDir);
    }
  };

  // ─── Renderers ────────────────────────────────────────────────────

  const renderInput = () => (
    <box flexDirection="column" gap={1}>
      <text>Enter website URL to scan for fonts:</text>
      <input
        value={url}
        onChange={setUrl}
        placeholder="https://example.com"
        focused={step === "input"}
        width={60}
        backgroundColor="#24283b"
        textColor="#a9b1d6"
        focusedBackgroundColor="#292e42"
      />
      {errorMsg && <text fg="#f7768e">Error: {errorMsg}</text>}
      <text fg="#565f89">Press ENTER to scan, ESC to quit</text>
      
      {/* Hidden button to capture enter press from input */}
      {step === "input" && (
        <box 
          focusable 
          onMouseDown={() => startDiscovery(url)}
        />
      )}
    </box>
  );

  // We need to capture Enter key when in 'input' step manually if the input component doesn't fire an 'onSubmit'.
  // Actually, we can just use useKeyboard for Enter.
  useKeyboard((key) => {
    if (step === "input" && key.name === "enter") {
      startDiscovery(url);
    } else if (step === "output_dir" && key.name === "enter") {
      startProcessing(fonts, selectedIndices, outputDir);
    }
  });

  const renderDiscovering = () => (
    <box flexDirection="column" gap={1} alignItems="center" justifyContent="center" height="100%">
      <text fg="#7aa2f7">Scanning {url}...</text>
      <text>{progressMsg || "Initializing browser..."}</text>
    </box>
  );

  const renderSelection = () => {
    const options = fonts.map((f, i) => {
      const isSelected = selectedIndices.has(i);
      const icon = isSelected ? "[x]" : "[ ]";
      const variant = formatVariant(f.weight, f.style);
      return {
        name: `${icon} ${f.family} - ${variant} ${f.isVariable ? '(Variable)' : ''}`,
        description: f.sources[0]?.url || "Local/Unknown",
        value: i
      };
    });
    
    options.push({ name: "▶ Continue", description: "Proceed to download", value: "done" as any });
    options.push({ name: "■ Toggle All", description: "Select or unselect all fonts", value: "toggle_all" as any });

    return (
      <box flexDirection="column" gap={1} height="100%">
        <text>
          Select fonts to download ({selectedIndices.size}/{fonts.length}):
        </text>
        <box border flexGrow={1}>
          <select
            options={options}
            focused={step === "selection"}
            showScrollIndicator
            onSelect={(index, option) => {
              if (!option) return;
              if (option.value === "done") {
                if (selectedIndices.size > 0) {
                  const domain = extractDomain(url);
                  const defaultDir = path.join(process.cwd(), 'fonts', domain);
                  setOutputDir(opts.output || defaultDir);
                  setStep("output_dir");
                } else {
                  setErrorMsg("Please select at least one font.");
                }
              } else if (option.value === "toggle_all") {
                if (selectedIndices.size === fonts.length) {
                  setSelectedIndices(new Set());
                } else {
                  setSelectedIndices(new Set(fonts.map((_, i) => i)));
                }
              } else {
                const newSel = new Set(selectedIndices);
                if (newSel.has(option.value as number)) {
                  newSel.delete(option.value as number);
                } else {
                  newSel.add(option.value as number);
                }
                setSelectedIndices(newSel);
                setErrorMsg("");
              }
            }}
            onChange={() => {}}
          />
        </box>
        {errorMsg && <text fg="#f7768e">{errorMsg}</text>}
        <text fg="#565f89">Use UP/DOWN to navigate, ENTER to toggle/select</text>
      </box>
    );
  };

  const renderOutputDir = () => (
    <box flexDirection="column" gap={1}>
      <text>Output Directory:</text>
      <input
        value={outputDir}
        onChange={setOutputDir}
        placeholder="./fonts"
        focused={step === "output_dir"}
        width={60}
        backgroundColor="#24283b"
        textColor="#a9b1d6"
        focusedBackgroundColor="#292e42"
      />
      <text fg="#565f89">Press ENTER to start downloading</text>
    </box>
  );

  const renderProcessing = () => (
    <box flexDirection="column" gap={1} alignItems="center" justifyContent="center" height="100%">
      <text fg="#bb9af7">Processing {selectedIndices.size} fonts...</text>
      <text>{progressMsg}</text>
    </box>
  );

  const renderResults = () => (
    <box flexDirection="column" gap={1} height="100%">
      <text fg="#9ece6a"><strong>Download Complete!</strong></text>
      
      {errorMsg ? (
        <text fg="#f7768e">Critical Error: {errorMsg}</text>
      ) : (
        <scrollbox focused style={{ rootOptions: { flexGrow: 1 } }}>
          <box flexDirection="column">
            <text>Successfully saved {finalResults.savedFiles.length} files.</text>
            <text> </text>
            {finalResults.converted.map((font, i) => (
              <text key={i}>
                - <span fg="#7aa2f7">{path.basename(finalResults.savedFiles[i])}</span> ({font.outputFormat.toUpperCase()}) {font.variableAxesPreserved ? <span fg="#9ece6a">[Variable]</span> : ""}
              </text>
            ))}
            
            {finalResults.failures.length > 0 && (
              <box flexDirection="column" marginTop={1}>
                <text fg="#f7768e">Failures:</text>
                {finalResults.failures.map((f, i) => (
                  <text key={i} fg="#f7768e">- {f}</text>
                ))}
              </box>
            )}
          </box>
        </scrollbox>
      )}
      <text fg="#565f89">Press ESC to exit</text>
    </box>
  );

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#1a1b26" padding={2}>
      <box paddingBottom={1} border borderColor="#3b4261">
        <text>
          <strong>font-grabber</strong> <span fg="#7aa2f7">v{VERSION}</span>
        </text>
        <text fg="#565f89">Grab fonts from any website · TTF/OTF</text>
      </box>
      
      <box flexGrow={1} paddingTop={1}>
        {step === "input" && renderInput()}
        {step === "discovering" && renderDiscovering()}
        {step === "selection" && renderSelection()}
        {step === "output_dir" && renderOutputDir()}
        {step === "processing" && renderProcessing()}
        {step === "results" && renderResults()}
      </box>
    </box>
  );
}

// ─── CLI setup ───────────────────────────────────────────────────────

const program = new Command();

program
  .name('font-grabber')
  .description('Grab fonts from any website and convert to TTF/OTF')
  .version(VERSION, '-v, --version')
  .argument('[url]', 'website URL to grab fonts from')
  .option('-o, --output <dir>', 'output directory for downloaded fonts')
  .option('-a, --all', 'download all fonts without prompting for selection')
  .option('-n, --anonymize', 'anonymize downloaded fonts (remove metadata)')
  .action(async (url: string | undefined, opts: any) => {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false, // Handled manually
    });
    
    const root = createRoot(renderer);
    root.render(<App initialUrl={url} opts={opts} />);
  });

program
  .command('anonymize')
  .description('Anonymize a local font file by stripping identifying metadata')
  .argument('<file>', 'path to the TTF/OTF font file to anonymize')
  .option('-o, --output <file>', 'output file path (default: <filename>-anon<ext> next to the original)')
  .action(async (file: string, opts: any) => {
    const inputPath = path.resolve(file);

    if (!fs.existsSync(inputPath)) {
      console.error(`\x1b[31mError: file not found: ${inputPath}\x1b[0m`);
      process.exit(1);
    }

    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    const dir = path.dirname(inputPath);
    const outputPath = opts.output
      ? path.resolve(opts.output)
      : path.join(dir, `${base}-anon${ext}`);

    console.log(`Anonymizing ${path.basename(inputPath)}...`);

    try {
      await anonymizeFont(inputPath, outputPath);
      console.log(`\x1b[32mSuccess: Saved to ${outputPath}\x1b[0m`);
    } catch (err) {
      console.error(`\x1b[31mAnonymization failed: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
      process.exit(1);
    }
  });

program.parse();
