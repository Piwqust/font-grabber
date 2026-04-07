/**
 * Font Discovery Module
 * 
 * Uses Puppeteer to load a webpage and extract all font information via:
 * 1. @font-face CSS rules (CSSOM) - including dynamically injected styles
 * 2. HTML/JS attribute scanning - catches fonts in Alpine.js x-data, Vue bindings, etc.
 * 3. Network request interception - catches any font file downloads
 */

import puppeteer from 'puppeteer';
import type { DiscoveredFont, FontSource } from './types.js';

/** Format preference order - prefer formats we can convert best */
const FORMAT_PRIORITY: Record<string, number> = {
  'woff2': 1,
  'woff': 2,
  'truetype': 3,
  'opentype': 4,
  'embedded-opentype': 5,
  'svg': 6,
};

/**
 * Normalize a font format string to a consistent value
 */
function normalizeFormat(format: string): string {
  const f = format.toLowerCase().trim().replace(/['"]/g, '');
  if (f.includes('woff2')) return 'woff2';
  if (f.includes('woff') && !f.includes('2')) return 'woff';
  if (f.includes('truetype') || f === 'ttf') return 'truetype';
  if (f.includes('opentype') || f === 'otf') return 'opentype';
  if (f.includes('embedded-opentype') || f === 'eot') return 'embedded-opentype';
  if (f.includes('svg')) return 'svg';
  return f;
}

/**
 * Guess format from URL file extension
 */
function guessFormatFromUrl(url: string): string {
  try {
    // Use a dummy base for protocol-relative or relative URLs
    const pathname = new URL(url, 'https://dummy.local').pathname.toLowerCase();
    if (pathname.endsWith('.woff2')) return 'woff2';
    if (pathname.endsWith('.woff')) return 'woff';
    if (pathname.endsWith('.ttf')) return 'truetype';
    if (pathname.endsWith('.otf')) return 'opentype';
    if (pathname.endsWith('.eot')) return 'embedded-opentype';
    if (pathname.endsWith('.svg')) return 'svg';
  } catch {
    // Malformed URL - fall through
  }
  return 'unknown';
}

/**
 * Convert a font family slug to a display name.
 * e.g., "gosha-sans" → "Gosha Sans", "pp-neue-montreal" → "PP Neue Montreal"
 */
function beautifyFontFamily(slug: string): string {
  return slug
    .split(/[-_]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** CSS numeric weight for common font name keywords */
const WEIGHT_KEYWORDS: Record<string, string> = {
  'thin': '100',
  'hairline': '100',
  'extralight': '200',
  'ultralight': '200',
  'light': '300',
  'regular': '400',
  'normal': '400',
  'book': '400',
  'medium': '500',
  'semibold': '600',
  'demibold': '600',
  'bold': '700',
  'extrabold': '800',
  'ultrabold': '800',
  'black': '900',
  'heavy': '900',
  'extrablack': '950',
  'ultrablack': '950',
};

/**
 * Detect font format from binary data magic bytes.
 */
function detectFontFormat(buffer: Buffer): string {
  if (buffer.length < 4) return 'truetype';
  // TrueType: 00 01 00 00
  if (buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) return 'truetype';
  // OpenType (CFF): OTTO
  if (buffer[0] === 0x4F && buffer[1] === 0x54 && buffer[2] === 0x54 && buffer[3] === 0x4F) return 'opentype';
  // WOFF: wOFF
  if (buffer[0] === 0x77 && buffer[1] === 0x4F && buffer[2] === 0x46 && buffer[3] === 0x46) return 'woff';
  // WOFF2: wOF2
  if (buffer[0] === 0x77 && buffer[1] === 0x4F && buffer[2] === 0x46 && buffer[3] === 0x32) return 'woff2';
  return 'truetype'; // Default for raw font data
}

/**
 * Parse a FontFace family name to extract weight, style, and clean family.
 * e.g., "Unica77LLCyr-BoldItalic" → { cleanFamily: "Unica77LLCyr", weight: "700", style: "italic" }
 */
function parseFontFamilyName(family: string): { cleanFamily: string; weight: string; style: string } {
  let weight = '400';
  let style = 'normal';
  let cleanFamily = family;

  // Try hyphen-split: "FamilyName-WeightStyle"
  const lastHyphen = family.lastIndexOf('-');
  if (lastHyphen > 0) {
    const prefix = family.substring(0, lastHyphen);
    const suffix = family.substring(lastHyphen + 1);
    const suffixLower = suffix.toLowerCase();

    // Check for italic
    const isItalic = suffixLower.endsWith('italic') || suffixLower.endsWith('it');
    if (isItalic) style = 'italic';

    // Remove italic suffix to isolate weight keyword
    const weightPart = suffixLower
      .replace(/italic$/, '')
      .replace(/it$/, '')
      .trim();

    if (weightPart && WEIGHT_KEYWORDS[weightPart]) {
      weight = WEIGHT_KEYWORDS[weightPart];
      cleanFamily = prefix;
    } else if (weightPart === '' && isItalic) {
      // Just "Italic" with no weight keyword → regular italic
      weight = '400';
      cleanFamily = prefix;
    }
  }

  return { cleanFamily, weight, style };
}

/**
 * Parse CSS @font-face src value to extract URL and format pairs.
 */
function parseSrcValue(src: string, baseUrl: string): FontSource[] {
  const sources: FontSource[] = [];
  // Match url(...) optionally followed by format(...)
  const urlRegex = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)\s*(?:format\(\s*['"]?([^'")\s]+)['"]?\s*\))?/gi;
  let match;
  
  while ((match = urlRegex.exec(src)) !== null) {
    let rawUrl = match[1];
    const rawFormat = match[2] || '';
    
    // Skip data: URLs
    if (rawUrl.startsWith('data:')) continue;
    
    // Resolve relative URLs
    try {
      rawUrl = new URL(rawUrl, baseUrl).href;
    } catch {
      continue;
    }
    
    const format = rawFormat ? normalizeFormat(rawFormat) : guessFormatFromUrl(rawUrl);
    
    // Skip SVG fonts - they can't be converted to TTF/OTF
    if (format === 'svg' || format === 'embedded-opentype') continue;
    
    sources.push({ url: rawUrl, format });
  }
  
  return sources;
}

/**
 * Discover fonts on a webpage by analyzing CSS @font-face rules.
 * Uses Puppeteer to load the page and intercept stylesheets.
 */
export async function discoverFonts(
  pageUrl: string,
  onProgress?: (message: string) => void
): Promise<DiscoveredFont[]> {
  const log = onProgress || (() => {});
  
  log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  try {
    const page = await browser.newPage();
    
    // Collect font URLs from network requests as a fallback
    const networkFontUrls = new Set<string>();
    page.on('response', (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      if (
        contentType.includes('font') ||
        /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url)
      ) {
        networkFontUrls.add(url);
      }
    });
    
    // Monkey-patch FontFace constructor to capture fonts loaded via JS FontFace API
    // (catches sites that fetch binary font bundles and register via new FontFace(name, data))
    await page.evaluateOnNewDocument(`
      (() => {
        const OriginalFontFace = window.FontFace;
        if (!OriginalFontFace) return;
        const capturedData = new Map();
        window.__capturedFontData = capturedData;

        window.FontFace = function FontFace(family, source, descriptors) {
          if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
            const bytes = source instanceof ArrayBuffer
              ? new Uint8Array(source)
              : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
            if (!capturedData.has(family)) {
              capturedData.set(family, new Uint8Array(bytes));
            }
          }
          return new OriginalFontFace(family, source, descriptors);
        };
        window.FontFace.prototype = OriginalFontFace.prototype;
      })();
    `);
    
    log('Loading page...');
    await page.goto(pageUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // Wait for dynamic font loading (JS frameworks like Alpine.js inject @font-face after page load)
    log('Waiting for dynamic fonts...');
    await page.evaluate(() => document.fonts.ready);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await page.evaluate(() => document.fonts.ready);
    
    log('Extracting @font-face rules...');
    
    // Extract @font-face data from all stylesheets via the CSSOM
    const fontFaceData = await page.evaluate(() => {
      const results: Array<{
        family: string;
        style: string;
        weight: string;
        src: string;
        unicodeRange: string;
      }> = [];
      
      // Iterate through all stylesheets (including cross-origin ones loaded by the browser)
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;
          
          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSFontFaceRule) {
              const style = rule.style;
              results.push({
                family: (style.getPropertyValue('font-family') || '').replace(/['"]/g, '').trim(),
                style: style.getPropertyValue('font-style') || 'normal',
                weight: style.getPropertyValue('font-weight') || '400',
                src: style.getPropertyValue('src') || '',
                unicodeRange: style.getPropertyValue('unicode-range') || '',
              });
            }
            // Also check @import rules which may contain @font-face
            if (rule instanceof CSSImportRule && rule.styleSheet) {
              try {
                const importedRules = rule.styleSheet.cssRules;
                for (const importedRule of Array.from(importedRules)) {
                  if (importedRule instanceof CSSFontFaceRule) {
                    const style = importedRule.style;
                    results.push({
                      family: (style.getPropertyValue('font-family') || '').replace(/['"]/g, '').trim(),
                      style: style.getPropertyValue('font-style') || 'normal',
                      weight: style.getPropertyValue('font-weight') || '400',
                      src: style.getPropertyValue('src') || '',
                      unicodeRange: style.getPropertyValue('unicode-range') || '',
                    });
                  }
                }
              } catch {
                // Cross-origin imported stylesheet
              }
            }
          }
        } catch {
          // Cross-origin stylesheet - skip
        }
      }
      
      return results;
    });
    
    // Scan HTML attributes and inline scripts for font references.
    // This catches fonts loaded by JS frameworks (Alpine.js x-data, Vue data bindings, etc.)
    // that may not appear in CSS @font-face rules.
    log('Scanning page markup for font references...');
    const htmlFontRefs = await page.evaluate(() => {
      const results: Array<{
        family: string;
        url: string;
        style: string;
        weight: string;
        isVariable: boolean;
      }> = [];
      const seen = new Set<string>();
      
      function addResult(family: string, url: string, style: string, weight: string, isVariable: boolean) {
        if (!url || seen.has(url)) return;
        seen.add(url);
        results.push({ family, url, style, weight, isVariable });
      }
      
      // Pattern to match quoted strings containing font file references (catches relative & absolute URLs)
      const quotedFontRefPattern = /['"]([^'"]*\.(?:woff2|woff|ttf|otf)(?:\?[^'"]*)?)['"]/gi;
      
      // Scan all element attributes for font references
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        for (const attr of Array.from(el.attributes)) {
          const val = attr.value;
          if (val.length < 5 || val.length > 100000) continue;
          
          // Quick check: does this attribute contain a font extension?
          if (!/\.(?:woff2|woff|ttf|otf)/i.test(val)) continue;
          
          // Try extracting structured font config (e.g., Alpine.js pageFont({...}))
          const familyMatch = val.match(/fontFamily\s*:\s*['"]([^'"]+)['"]/);
          const baseFileMatch = val.match(/baseFontFile\s*:\s*['"]([^'"]+)['"]/);
          const italicFileMatch = val.match(/italicFontFile\s*:\s*['"]([^'"]*)['"]/);
          const isVarMatch = val.match(/isVariable\s*:\s*(true|false)/i);
          const weightMatch = val.match(/defaultWeight\s*:\s*(\d+)/);
          const styleMatch = val.match(/defaultStyle\s*:\s*['"]([^'"]+)['"]/);
          
          if (baseFileMatch) {
            const family = familyMatch ? familyMatch[1] : '';
            const isVariable = isVarMatch ? isVarMatch[1].toLowerCase() === 'true' : false;
            const weight = isVariable ? '100 900' : (weightMatch ? weightMatch[1] : '400');
            const style = styleMatch ? styleMatch[1] : 'normal';
            
            if (baseFileMatch[1].trim()) {
              addResult(family, baseFileMatch[1].trim(), style, weight, isVariable);
            }
            if (italicFileMatch && italicFileMatch[1].trim()) {
              addResult(family, italicFileMatch[1].trim(), 'italic', weight, isVariable);
            }
            continue;
          }
          
          // Generic: extract quoted strings containing font file references
          quotedFontRefPattern.lastIndex = 0;
          let match;
          while ((match = quotedFontRefPattern.exec(val)) !== null) {
            addResult('', match[1], 'normal', '400', false);
          }
        }
      }
      
      // Scan inline <script> tags for font URLs
      const scripts = document.querySelectorAll('script:not([src])');
      for (const script of scripts) {
        const content = script.textContent || '';
        if (content.length < 5 || content.length > 1000000) continue;
        if (!/\.(?:woff2|woff|ttf|otf)/i.test(content)) continue;
        
        quotedFontRefPattern.lastIndex = 0;
        let match;
        while ((match = quotedFontRefPattern.exec(content)) !== null) {
          addResult('', match[1], 'normal', '400', false);
        }
      }
      
      return results;
    });
    
    log(`Found ${fontFaceData.length} @font-face rules, ${htmlFontRefs.length} markup references`);
    
    // Retrieve fonts captured from FontFace API (binary data loaded via JS)
    log('Checking for JS FontFace API fonts...');
    const capturedFontFaces: Array<{ family: string; data: Buffer; format: string }> = [];
    
    const capturedEntries = await page.evaluate(() => {
      const data = (window as any).__capturedFontData as Map<string, Uint8Array> | undefined;
      if (!data || data.size === 0) return [];
      
      const results: Array<{ family: string; base64: string }> = [];
      for (const [family, bytes] of data.entries()) {
        if (bytes.length < 100) continue; // Skip tiny/invalid entries
        // Convert Uint8Array to base64 in chunks (avoid call stack overflow)
        let binary = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(
            null, Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
          );
        }
        results.push({ family, base64: btoa(binary) });
      }
      return results;
    });
    
    for (const entry of capturedEntries) {
      const buffer = Buffer.from(entry.base64, 'base64');
      const format = detectFontFormat(buffer);
      capturedFontFaces.push({ family: entry.family, data: buffer, format });
    }
    
    if (capturedFontFaces.length > 0) {
      log(`Captured ${capturedFontFaces.length} fonts from FontFace API`);
    }
    
    // Build DiscoveredFont entries, deduplicating and grouping by family+weight+style
    const fontMap = new Map<string, DiscoveredFont>();
    
    for (const ff of fontFaceData) {
      if (!ff.family || !ff.src) continue;
      
      const sources = parseSrcValue(ff.src, pageUrl);
      if (sources.length === 0) continue;
      
      // Detect variable font: weight range like "100 900" or style range
      const isVariable = /\d+\s+\d+/.test(ff.weight) || /\d+\s+\d+/.test(ff.style);
      
      const key = `${ff.family}|${ff.weight}|${ff.style}`;
      
      const existing = fontMap.get(key);
      if (existing) {
        // Merge sources, avoiding duplicates
        for (const src of sources) {
          if (!existing.sources.some(s => s.url === src.url)) {
            existing.sources.push(src);
          }
        }
        if (isVariable) existing.isVariable = true;
      } else {
        fontMap.set(key, {
          key,
          family: ff.family,
          style: ff.style.trim(),
          weight: ff.weight.trim(),
          sources,
          isVariable,
          unicodeRange: ff.unicodeRange || undefined,
        });
      }
    }
    
    // Add fonts discovered from HTML/JS attribute scanning
    for (const hf of htmlFontRefs) {
      let resolvedUrl = hf.url;
      try {
        resolvedUrl = new URL(hf.url, pageUrl).href;
      } catch { continue; }
      
      // Skip if this URL is already tracked by @font-face rules
      const alreadyTracked = Array.from(fontMap.values()).some(f =>
        f.sources.some(s => s.url === resolvedUrl)
      );
      if (alreadyTracked) continue;
      
      const format = guessFormatFromUrl(resolvedUrl);
      if (format === 'svg' || format === 'embedded-opentype' || format === 'unknown') continue;
      
      const family = hf.family ? beautifyFontFamily(hf.family) : '(Unknown - from markup)';
      const key = `${family}|${hf.weight}|${hf.style}`;
      
      const existing = fontMap.get(key);
      if (existing) {
        if (!existing.sources.some(s => s.url === resolvedUrl)) {
          existing.sources.push({ url: resolvedUrl, format });
        }
        if (hf.isVariable) existing.isVariable = true;
      } else {
        fontMap.set(key, {
          key,
          family,
          style: hf.style,
          weight: hf.weight,
          sources: [{ url: resolvedUrl, format }],
          isVariable: hf.isVariable,
        });
      }
    }
    
    // Add fonts captured from FontFace API (JS-loaded binary data)
    for (const cf of capturedFontFaces) {
      const { cleanFamily, weight, style } = parseFontFamilyName(cf.family);
      const key = `${cleanFamily}|${weight}|${style}`;
      
      // Skip if already tracked by CSS or HTML scanning
      if (fontMap.has(key)) continue;
      
      fontMap.set(key, {
        key,
        family: cleanFamily,
        style,
        weight,
        sources: [{ url: `fontface://${encodeURIComponent(cf.family)}`, format: cf.format }],
        isVariable: false,
        inlineData: cf.data,
      });
    }
    
    // Sort sources by format preference
    for (const font of fontMap.values()) {
      font.sources.sort((a, b) => {
        return (FORMAT_PRIORITY[a.format] || 99) - (FORMAT_PRIORITY[b.format] || 99);
      });
    }
    
    // If we found network fonts not in any @font-face, add them as unknowns
    for (const netUrl of networkFontUrls) {
      const alreadyTracked = Array.from(fontMap.values()).some(f =>
        f.sources.some(s => s.url === netUrl)
      );
      if (!alreadyTracked) {
        const format = guessFormatFromUrl(netUrl);
        if (format === 'svg' || format === 'embedded-opentype' || format === 'unknown') continue;
        
        const key = `__network__|${netUrl}`;
        fontMap.set(key, {
          key,
          family: '(Unknown - from network)',
          style: 'normal',
          weight: '400',
          sources: [{ url: netUrl, format }],
          isVariable: false,
        });
      }
    }
    
    const fonts = Array.from(fontMap.values());
    log(`Discovered ${fonts.length} unique font variants`);
    
    return fonts;
  } finally {
    await browser.close();
  }
}
