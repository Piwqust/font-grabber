import fs from 'node:fs';
import path from 'node:path';
import opentype from 'opentype.js';

/**
 * Anonymizes a font file by removing all identifying metadata from its name table.
 * It replaces the font family with a generic name and clears copyright, manufacturer, designer, etc.
 * 
 * @param fontPath Path to the input TTF/OTF font file
 * @param outputPath Path to save the anonymized font
 */
export async function anonymizeFont(fontPath: string, outputPath: string): Promise<void> {
    try {
        const buffer = fs.readFileSync(fontPath);
        // Cast as any because opentype.js types can be tricky with ArrayBuffer
        const font = opentype.parse(buffer.buffer as any);
        
        // Fields to clear completely
        const fieldsToClear = [
            'copyright',
            'designer',
            'designerURL',
            'manufacturer',
            'manufacturerURL',
            'license',
            'licenseURL',
            'version',
            'description',
            'trademark',
            'uniqueID',
            'preferredFamily',
            'preferredSubfamily'
        ];

        // Replace identifying fields with generic ones
        const genericName = `AnonFont-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        
        const fieldsToAnonymize = {
            'fontFamily': genericName,
            'fontSubfamily': font.names.fontSubfamily?.en || 'Regular',
            'fullName': `${genericName} ${font.names.fontSubfamily?.en || 'Regular'}`,
            'postScriptName': genericName.replace(/[^a-zA-Z0-9]/g, '')
        };

        // Apply changes
        const names = font.names as Record<string, any>;
        for (const field of fieldsToClear) {
            if (names[field]) {
                for (const lang of Object.keys(names[field])) {
                    names[field][lang] = '';
                }
            }
        }

        for (const [field, value] of Object.entries(fieldsToAnonymize)) {
            if (!names[field]) {
                names[field] = { en: value };
            } else {
                for (const lang of Object.keys(names[field])) {
                    names[field][lang] = value;
                }
            }
        }

        // Export and save
        const outBuffer = font.toArrayBuffer();
        fs.writeFileSync(outputPath, Buffer.from(outBuffer));
    } catch (err) {
        throw new Error(`Failed to anonymize font ${fontPath}: ${(err as Error).message}`);
    }
}
