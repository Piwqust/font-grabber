#!/usr/bin/env node
/// <reference types="@opentui/react" />

/**
 * Font Grabber CLI - OpenTUI React version
 * Completely redesigned dashboard interface.
 */

import { Command } from 'commander';
import React, { useState, useEffect, useRef } from 'react';
import { createCliRenderer, RGBA } from '@opentui/core';
import { createRoot, useKeyboard, useRenderer } from '@opentui/react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { discoverFonts } from './discovery.js';
import { downloadFontsToCache } from './downloader.js';
import { convertCachedFonts } from './converter.js';
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

// ─── Theme ────────────────────────────────────────────────────────────

const theme = {
  bg: "#1a1b26",
  panelBg: "#24283b",
  border: "#414868",
  borderActive: "#7aa2f7",
  text: "#a9b1d6",
  textMuted: "#565f89",
  primary: "#7aa2f7",
  success: "#9ece6a",
  warning: "#e0af68",
  error: "#f7768e",
  highlight: "#292e42",
};

// ─── App Component ──────────────────────────────────────────────────

type Panel = "url" | "output" | "list";

function App({ initialUrl, opts }: { initialUrl?: string; opts: any }) {
  const renderer = useRenderer();

  const [activePanel, setActivePanel] = useState<Panel>("url");
  const [url, setUrl] = useState(initialUrl || "");
  const [outputDir, setOutputDir] = useState(opts.output || path.join(process.cwd(), 'fonts'));
  
  const [fonts, setFonts] = useState<DiscoveredFont[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  
  const [status, setStatus] = useState<"Idle" | "Discovering" | "Ready" | "Processing" | "Done" | "Error">("Idle");
  const [logs, setLogs] = useState<string[]>(["Welcome to Font Grabber CLI.", "Enter a URL and press ENTER to discover fonts."]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useKeyboard((key) => {
    if ((key.ctrl && key.name === "c") || key.name === "escape") {
      renderer.destroy();
      process.exit(0);
    }

    if (status === "Discovering" || status === "Processing") return;

    if (key.name === "tab") {
      setActivePanel(prev => {
        if (prev === "url") return "output";
        if (prev === "output") return "list";
        return "url";
      });
    }

    if (activePanel === "list") {
      if (key.name === "a") {
        if (selectedIndices.size === fonts.length) {
          setSelectedIndices(new Set());
          addLog("Deselected all fonts.");
        } else {
          setSelectedIndices(new Set(fonts.map((_, i) => i)));
          addLog("Selected all fonts.");
        }
      } else if (key.name === "d") {
        if (selectedIndices.size > 0) {
          startProcessing();
        } else {
          addLog("Error: No fonts selected to download.");
        }
      } else if (key.name === "space") {
        const newSel = new Set(selectedIndices);
        if (newSel.has(highlightedIndex)) newSel.delete(highlightedIndex);
        else newSel.add(highlightedIndex);
        setSelectedIndices(newSel);
      }
    }
  });

  useEffect(() => {
    if (initialUrl && isValidUrl(initialUrl)) {
      startDiscovery(initialUrl);
    }
  }, []);

  const startDiscovery = async (targetUrl: string) => {
    let normalized = targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`;
    if (!isValidUrl(normalized)) {
      addLog(`Error: Invalid URL ${targetUrl}`);
      setStatus("Error");
      return;
    }
    
    setUrl(normalized);
    setStatus("Discovering");
    addLog(`Scanning ${normalized} for fonts...`);

    try {
      const discovered = await discoverFonts(normalized, (msg) => {
        addLog(msg);
      });
      
      setFonts(discovered);
      
      if (discovered.length === 0) {
        addLog("No fonts found on this page.");
        setStatus("Idle");
        return;
      }
      
      addLog(`Found ${discovered.length} fonts.`);
      
      const domain = extractDomain(normalized);
      if (!opts.output) {
        setOutputDir(path.join(process.cwd(), 'fonts', domain));
      }

      if (opts.all) {
        setSelectedIndices(new Set(discovered.map((_, i) => i)));
        addLog("Auto-selected all fonts (--all).");
      } else {
        setSelectedIndices(new Set(discovered.map((_, i) => i)));
      }
      
      setStatus("Ready");
      setActivePanel("list");
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setStatus("Error");
    }
  };

  const startProcessing = async () => {
    if (selectedIndices.size === 0) return;
    
    setStatus("Processing");
    const targetFonts = fonts.filter((_, i) => selectedIndices.has(i));
    addLog(`Starting download of ${targetFonts.length} fonts to ${outputDir}...`);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const cacheDir = createCacheDir();
    let successCount = 0;
    let failCount = 0;
    
    try {
      // 1. Download
      addLog("Downloading fonts to cache...");
      const cached = await downloadFontsToCache(targetFonts, cacheDir, 4, (completed, total, font) => {
        addLog(`Downloaded [${completed}/${total}]: ${font.family}`);
      });
      
      // 2. Convert
      addLog("Converting fonts...");
      const converted = await convertCachedFonts(cached, (completed, total, font, error) => {
        if (error) {
          const f = cached[completed - 1];
          addLog(`Convert error on ${f.info.family}: ${error.message}`);
          failCount++;
        } else if (font) {
          addLog(`Converted [${completed}/${total}]: ${font.filename}`);
        }
      });
      
      // 3. Save
      for (const font of converted) {
        const familyDir = sanitizeFamilyDir(font.info.family);
        const familyPath = path.join(outputDir, familyDir);
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
        successCount++;
      }
      
      addLog(`Done! Successfully saved ${successCount} fonts. Failed: ${failCount}.`);
      setStatus("Done");
    } catch (err) {
      addLog(`Critical Error: ${err instanceof Error ? err.message : String(err)}`);
      setStatus("Error");
    } finally {
      cleanupCacheDir(cacheDir);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────

  const fontOptions = fonts.map((f, i) => {
    const isSelected = selectedIndices.has(i);
    const icon = isSelected ? "[x]" : "[ ]";
    const variant = formatVariant(f.weight, f.style);
    return {
      name: `${icon} ${f.family} - ${variant} ${f.isVariable ? '(Variable)' : ''}`,
      description: f.sources[0]?.url || "Local/Unknown",
      value: i
    };
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme.bg}>
      {/* Header */}
      <box height={5} border borderStyle="rounded" borderColor={theme.primary} alignItems="center" justifyContent="center" backgroundColor={theme.panelBg} marginX={1} marginTop={1}>
        <ascii-font text="FONT GRABBER" font="tiny" color={RGBA.fromHex(theme.primary)} />
        <text fg={theme.textMuted}> v{VERSION}</text>
      </box>

      {/* Main Content */}
      <box flexDirection="row" flexGrow={1} marginX={1} marginBottom={1} gap={1}>
        {/* Sidebar */}
        <box width={40} flexDirection="column" border borderStyle="rounded" borderColor={activePanel === "url" || activePanel === "output" ? theme.borderActive : theme.border} title=" Configuration " titleAlignment="left" padding={1} gap={1} backgroundColor={theme.panelBg}>
          
          <text fg={theme.text}>URL:</text>
          <input
            value={url}
            onInput={setUrl as any}
            onSubmit={(val: any) => startDiscovery(val)}
            placeholder="https://example.com"
            focused={activePanel === "url"}
            width={36}
            backgroundColor={theme.highlight}
            textColor={theme.text}
            focusedBackgroundColor={theme.bg}
          />
          
          <text fg={theme.text}>Output Directory:</text>
          <input
            value={outputDir}
            onInput={setOutputDir as any}
            onSubmit={(val: any) => {
              if (selectedIndices.size > 0) {
                startProcessing();
              } else {
                addLog("Error: No fonts selected to download.");
              }
            }}
            placeholder="./fonts"
            focused={activePanel === "output"}
            width={36}
            backgroundColor={theme.highlight}
            textColor={theme.text}
            focusedBackgroundColor={theme.bg}
          />
          
          <box flexGrow={1} />
          
          <box flexDirection="column" gap={0}>
            <text fg={theme.textMuted}>Status: <span fg={status === "Error" ? theme.error : status === "Done" ? theme.success : status === "Processing" || status === "Discovering" ? theme.warning : theme.primary}>{status}</span></text>
            <text fg={theme.textMuted}>──────────────────────────────</text>
            <text fg={theme.textMuted}>[TAB] Switch Panel</text>
            <text fg={theme.textMuted}>[ESC] Exit</text>
            {activePanel === "url" && <text fg={theme.primary}>[ENTER] Discover Fonts</text>}
          </box>
        </box>

        {/* Right Content */}
        <box flexGrow={1} flexDirection="column" gap={1}>
          {/* Font List */}
          <box flexGrow={2} border borderStyle="rounded" borderColor={activePanel === "list" ? theme.borderActive : theme.border} title={` Discovered Fonts (${selectedIndices.size}/${fonts.length}) `} titleAlignment="left" padding={1} flexDirection="column" backgroundColor={theme.panelBg}>
            <box flexDirection="row" justifyContent="flex-end">
              {activePanel === "list" && <text fg={theme.textMuted}>[ENTER/SPACE] Toggle | [A] Toggle All | [D] Download</text>}
            </box>
            
            <box flexGrow={1} marginTop={1} height={20}>
              {fonts.length > 0 ? (
                <select
                  options={fontOptions}
                  focused={activePanel === "list"}
                  showScrollIndicator
                  height={18}
                  selectedBackgroundColor={theme.highlight}
                  selectedTextColor={theme.primary}
                  onSelect={(index, option) => {
                    if (!option) return;
                    const val = option.value as number;
                    const newSel = new Set(selectedIndices);
                    if (newSel.has(val)) newSel.delete(val);
                    else newSel.add(val);
                    setSelectedIndices(newSel);
                  }}
                  onChange={(index) => setHighlightedIndex(index)}
                />
              ) : (
                <box flexGrow={1} alignItems="center" justifyContent="center">
                  <text fg={theme.textMuted}>No fonts discovered yet. Enter a URL and press ENTER.</text>
                </box>
              )}
            </box>
          </box>

          {/* Logs */}
          <box height={12} border borderStyle="rounded" borderColor={theme.border} title=" Logs " titleAlignment="left" padding={1} flexDirection="column" backgroundColor={theme.bg}>
            <scrollbox focused={false} style={{ rootOptions: { flexGrow: 1 } }}>
              <box flexDirection="column">
                {logs.map((log, i) => (
                  <text key={i} fg={log.includes("Error") ? theme.error : log.includes("Done") ? theme.success : theme.text}>{log}</text>
                ))}
              </box>
            </scrollbox>
          </box>
        </box>
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
  .action(async (url: string | undefined, opts: any) => {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
    });
    
    const root = createRoot(renderer);
    root.render(<App initialUrl={url} opts={opts} />);
  });

program.parse();
