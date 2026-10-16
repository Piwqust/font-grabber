//! Joins the pieces of one face that a site serves as separate files.
//!
//! Foundries and font services split a face by character set: Google Fonts
//! serves a Latin file, a Cyrillic file and so on behind `unicode-range`, and
//! some foundries ship a "core" file with ASCII and an "ext" file with the
//! rest. Each piece is a valid font, but none is the font. This puts them back
//! together into one TrueType file.
//!
//! The first file is the base: its glyph IDs, tables and layout features stay
//! exactly as they are. Glyphs from the other files are appended after them,
//! composite references are renumbered, and `cmap`, `hmtx`, `maxp`, `gvar`
//! and the bounding boxes are rebuilt for the larger glyph set. Layout
//! features of the appended files are not merged, so their kerning and mark
//! positioning is lost; precomposed accented letters, which is what extension
//! files mostly hold, are unaffected.
//!
//! Only TrueType outlines can be joined this way. CFF pieces, bitmap or colour
//! glyphs, or pieces that were never one design are refused with an error, and
//! the caller ships the pieces separately instead.

use std::collections::BTreeMap;

use anyhow::{bail, ensure, Context, Result};
use ttf_parser::Face;

/// Glyph-indexed tables that cannot be renumbered here: they are dropped, and
/// renderers fall back to the data that stays (`gvar` phantom points, `hmtx`).
const DROPPED_TABLES: &[&[u8; 4]] = &[
    b"hdmx", b"LTSH", b"VDMX", b"DSIG", b"HVAR", b"VVAR", b"vhea", b"vmtx", b"VORG",
];
/// Tables whose glyphs cannot be carried over at all.
const UNSUPPORTED_TABLES: &[&[u8; 4]] = &[
    b"CFF ", b"CFF2", b"COLR", b"CPAL", b"sbix", b"CBDT", b"CBLC", b"EBDT", b"EBLC", b"SVG ",
];

/// Joins `parts` onto `base`. All inputs are uncompressed sfnt data.
pub fn merge_sfnts(base: &[u8], parts: &[Vec<u8>]) -> Result<Vec<u8>> {
    let mut merged = base.to_vec();
    for part in parts {
        merged = merge_two(&merged, part)?;
    }
    Ok(merged)
}

struct Font<'a> {
    tables: BTreeMap<[u8; 4], &'a [u8]>,
    glyphs: Vec<&'a [u8]>,
    metrics: Vec<(u16, i16)>,
    cmap: BTreeMap<u32, u16>,
}

impl<'a> Font<'a> {
    fn parse(data: &'a [u8]) -> Result<Self> {
        let tables = read_directory(data)?;
        for tag in UNSUPPORTED_TABLES {
            ensure!(
                !tables.contains_key(*tag),
                "{} outlines cannot be joined",
                String::from_utf8_lossy(*tag).trim()
            );
        }
        let table = |tag: &[u8; 4]| {
            tables
                .get(tag)
                .copied()
                .with_context(|| format!("missing {} table", String::from_utf8_lossy(tag)))
        };
        let head = table(b"head")?;
        let maxp = table(b"maxp")?;
        let loca = table(b"loca")?;
        let glyf = table(b"glyf")?;
        let hhea = table(b"hhea")?;
        let hmtx = table(b"hmtx")?;

        let count = u16_at(maxp, 4)? as usize;
        let long_loca = i16_at(head, 50)? == 1;
        let offset = |index: usize| -> Result<usize> {
            Ok(if long_loca {
                u32_at(loca, index * 4)? as usize
            } else {
                u16_at(loca, index * 2)? as usize * 2
            })
        };
        let mut glyphs = Vec::with_capacity(count);
        for index in 0..count {
            let (start, end) = (offset(index)?, offset(index + 1)?);
            ensure!(
                start <= end && end <= glyf.len(),
                "glyph {index} lies outside glyf"
            );
            glyphs.push(&glyf[start..end]);
        }

        let long_metrics = u16_at(hhea, 34)? as usize;
        ensure!(
            long_metrics >= 1 && long_metrics <= count,
            "bad hhea.numberOfHMetrics"
        );
        let mut metrics = Vec::with_capacity(count);
        for index in 0..count {
            if index < long_metrics {
                metrics.push((u16_at(hmtx, index * 4)?, i16_at(hmtx, index * 4 + 2)?));
            } else {
                let advance = metrics[long_metrics - 1].0;
                let lsb = i16_at(hmtx, long_metrics * 4 + (index - long_metrics) * 2).unwrap_or(0);
                metrics.push((advance, lsb));
            }
        }

        let face = Face::parse(data, 0).context("unreadable font")?;
        let mut cmap = BTreeMap::new();
        if let Some(table) = face.tables().cmap {
            for subtable in table.subtables {
                if !subtable.is_unicode() {
                    continue;
                }
                subtable.codepoints(|codepoint| {
                    if let Some(glyph) = subtable.glyph_index(codepoint) {
                        if glyph.0 != 0 {
                            cmap.entry(codepoint).or_insert(glyph.0);
                        }
                    }
                });
            }
        }

        Ok(Self {
            tables,
            glyphs,
            metrics,
            cmap,
        })
    }

    fn table(&self, tag: &[u8; 4]) -> Option<&'a [u8]> {
        self.tables.get(tag).copied()
    }
}

fn merge_two(base_data: &[u8], part_data: &[u8]) -> Result<Vec<u8>> {
    let base = Font::parse(base_data).context("the first file")?;
    let part = Font::parse(part_data).context("an added file")?;

    let units = |font: &Font| font.table(b"head").map(|head| u16_at(head, 18)).transpose();
    ensure!(
        units(&base)? == units(&part)?,
        "the files use different units per em, so they are not one design"
    );

    // Pieces of one face cover different characters. Two files that mostly
    // overlap are two different fonts that happened to be grouped together.
    let shared = part
        .cmap
        .keys()
        .filter(|cp| base.cmap.contains_key(cp))
        .count();
    let smaller = base.cmap.len().min(part.cmap.len()).max(1);
    ensure!(
        shared * 4 <= smaller,
        "the files cover the same characters, so they are not pieces of one font"
    );

    let base_count = base.glyphs.len();
    let total = base_count + part.glyphs.len().saturating_sub(1);
    ensure!(
        total <= u16::MAX as usize,
        "the joined font would have too many glyphs"
    );
    let renumber = |glyph: u16| -> u16 {
        if glyph == 0 {
            0
        } else {
            (base_count + glyph as usize - 1) as u16
        }
    };

    // Hinting programs belong to the file they came from. Pieces cut from one
    // master share them; otherwise the added glyphs lose their instructions
    // rather than run someone else's.
    let same_hinting = [b"fpgm", b"prep", b"cvt "]
        .iter()
        .all(|tag| base.table(tag) == part.table(tag));

    let mut glyphs: Vec<Vec<u8>> = base.glyphs.iter().map(|glyph| glyph.to_vec()).collect();
    for glyph in &part.glyphs[1..] {
        glyphs.push(rewrite_glyph(glyph, &renumber, !same_hinting)?);
    }
    let mut metrics = base.metrics.clone();
    metrics.extend_from_slice(&part.metrics[1..]);

    let mut cmap = base.cmap.clone();
    for (codepoint, glyph) in &part.cmap {
        cmap.entry(*codepoint).or_insert_with(|| renumber(*glyph));
    }

    let mut glyf = Vec::new();
    let mut loca = Vec::with_capacity((glyphs.len() + 1) * 4);
    for glyph in &glyphs {
        loca.extend_from_slice(&(glyf.len() as u32).to_be_bytes());
        glyf.extend_from_slice(glyph);
        while glyf.len() % 4 != 0 {
            glyf.push(0);
        }
    }
    loca.extend_from_slice(&(glyf.len() as u32).to_be_bytes());

    let mut tables: BTreeMap<[u8; 4], Vec<u8>> = base
        .tables
        .iter()
        .filter(|(tag, _)| !DROPPED_TABLES.contains(tag))
        .map(|(tag, data)| (*tag, data.to_vec()))
        .collect();

    tables.insert(*b"glyf", glyf);
    tables.insert(*b"loca", loca);
    tables.insert(*b"hmtx", build_hmtx(&metrics));
    tables.insert(*b"cmap", build_cmap(&cmap)?);
    tables.insert(
        *b"head",
        merge_head(base.table(b"head").unwrap(), part.table(b"head").unwrap())?,
    );
    tables.insert(
        *b"hhea",
        merge_hhea(base.table(b"hhea").unwrap(), &metrics, &glyphs)?,
    );
    tables.insert(
        *b"maxp",
        merge_maxp(
            base.table(b"maxp").unwrap(),
            part.table(b"maxp").unwrap(),
            glyphs.len(),
        )?,
    );
    if let Some(post) = base.table(b"post") {
        tables.insert(*b"post", post_without_names(post)?);
    }
    if let Some(os2) = base.table(b"OS/2") {
        tables.insert(*b"OS/2", merge_os2(os2, part.table(b"OS/2"), &cmap)?);
    }
    match (base.table(b"gvar"), part.table(b"gvar")) {
        (None, None) => {}
        (Some(base_gvar), Some(part_gvar)) => {
            tables.insert(
                *b"gvar",
                merge_gvar(base_gvar, part_gvar, base_count, glyphs.len())?,
            );
        }
        _ => bail!("only one of the files is variable"),
    }

    build_sfnt(tables)
}

/// Renumbers component references and, when asked, drops TrueType instructions.
fn rewrite_glyph(glyph: &[u8], renumber: &dyn Fn(u16) -> u16, strip: bool) -> Result<Vec<u8>> {
    if glyph.is_empty() {
        return Ok(Vec::new());
    }
    let contours = i16_at(glyph, 0)?;
    if contours >= 0 {
        if !strip {
            return Ok(glyph.to_vec());
        }
        let ends = 10 + contours as usize * 2;
        let length = u16_at(glyph, ends)? as usize;
        ensure!(
            ends + 2 + length <= glyph.len(),
            "glyph instructions overrun"
        );
        let mut out = glyph[..ends].to_vec();
        out.extend_from_slice(&0u16.to_be_bytes());
        out.extend_from_slice(&glyph[ends + 2 + length..]);
        return Ok(out);
    }

    const WORDS: u16 = 0x0001;
    const SCALE: u16 = 0x0008;
    const MORE: u16 = 0x0020;
    const XY_SCALE: u16 = 0x0040;
    const TWO_BY_TWO: u16 = 0x0080;
    const INSTRUCTIONS: u16 = 0x0100;

    let mut out = glyph.to_vec();
    let mut offset = 10;
    loop {
        let flags = u16_at(glyph, offset)?;
        let component = u16_at(glyph, offset + 2)?;
        out[offset + 2..offset + 4].copy_from_slice(&renumber(component).to_be_bytes());
        let mut size = 4 + if flags & WORDS != 0 { 4 } else { 2 };
        size += if flags & SCALE != 0 {
            2
        } else if flags & XY_SCALE != 0 {
            4
        } else if flags & TWO_BY_TWO != 0 {
            8
        } else {
            0
        };
        if flags & MORE == 0 {
            if strip && flags & INSTRUCTIONS != 0 {
                out[offset..offset + 2].copy_from_slice(&(flags & !INSTRUCTIONS).to_be_bytes());
                out.truncate(offset + size);
            }
            break;
        }
        offset += size;
        ensure!(offset + 4 <= glyph.len(), "composite glyph overrun");
    }
    Ok(out)
}

fn build_hmtx(metrics: &[(u16, i16)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(metrics.len() * 4);
    for (advance, lsb) in metrics {
        out.extend_from_slice(&advance.to_be_bytes());
        out.extend_from_slice(&lsb.to_be_bytes());
    }
    out
}

/// A Windows BMP subtable (format 4) when it fits, and a full-range one
/// (format 12) always, so characters beyond U+FFFF survive too.
fn build_cmap(map: &BTreeMap<u32, u16>) -> Result<Vec<u8>> {
    let mut groups: Vec<(u32, u32, u16)> = Vec::new();
    for (&codepoint, &glyph) in map {
        if let Some((start, end, first)) = groups.last_mut() {
            if *end + 1 == codepoint && u32::from(*first) + (codepoint - *start) == u32::from(glyph)
            {
                *end = codepoint;
                continue;
            }
        }
        groups.push((codepoint, codepoint, glyph));
    }

    let mut format12 = Vec::new();
    format12.extend_from_slice(&12u16.to_be_bytes());
    format12.extend_from_slice(&0u16.to_be_bytes());
    format12.extend_from_slice(&((16 + groups.len() * 12) as u32).to_be_bytes());
    format12.extend_from_slice(&0u32.to_be_bytes());
    format12.extend_from_slice(&(groups.len() as u32).to_be_bytes());
    for (start, end, glyph) in &groups {
        format12.extend_from_slice(&start.to_be_bytes());
        format12.extend_from_slice(&end.to_be_bytes());
        format12.extend_from_slice(&u32::from(*glyph).to_be_bytes());
    }

    let format4 = build_format4(&groups);
    let mut subtables: Vec<(u16, u16, Vec<u8>)> = Vec::new();
    if let Some(format4) = format4 {
        subtables.push((0, 3, format4.clone()));
        subtables.push((3, 1, format4));
    }
    subtables.push((0, 4, format12.clone()));
    subtables.push((3, 10, format12));

    let mut out = Vec::new();
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&(subtables.len() as u16).to_be_bytes());
    let mut offset = 4 + subtables.len() * 8;
    // Identical subtables are written once and shared, as most fonts do.
    let mut written: Vec<(Vec<u8>, usize)> = Vec::new();
    let mut body = Vec::new();
    for (platform, encoding, data) in &subtables {
        let at = match written.iter().find(|(seen, _)| seen == data) {
            Some((_, at)) => *at,
            None => {
                let at = offset;
                body.extend_from_slice(data);
                offset += data.len();
                written.push((data.clone(), at));
                at
            }
        };
        out.extend_from_slice(&platform.to_be_bytes());
        out.extend_from_slice(&encoding.to_be_bytes());
        out.extend_from_slice(&(at as u32).to_be_bytes());
    }
    out.extend_from_slice(&body);
    Ok(out)
}

fn build_format4(groups: &[(u32, u32, u16)]) -> Option<Vec<u8>> {
    // Delta segments: each run of consecutive characters and glyphs is one
    // segment, which is how font compilers write it too.
    let mut segments: Vec<(u16, u16, i16)> = groups
        .iter()
        .filter(|(start, _, _)| *start <= 0xFFFE)
        .map(|(start, end, glyph)| {
            let end = (*end).min(0xFFFE);
            let delta = (i32::from(*glyph) - *start as i32).rem_euclid(65536) as u16 as i16;
            (*start as u16, end as u16, delta)
        })
        .collect();
    segments.push((0xFFFF, 0xFFFF, 1));
    let count = segments.len();
    let length = 16 + count * 8;
    if length > u16::MAX as usize {
        return None;
    }
    let power = largest_power_of_two_le(count as u16);
    let search = power * 2;
    let selector = power.trailing_zeros() as u16;
    let mut out = Vec::with_capacity(length);
    for value in [
        4u16,
        length as u16,
        0,
        (count * 2) as u16,
        search,
        selector,
        (count * 2) as u16 - search,
    ] {
        out.extend_from_slice(&value.to_be_bytes());
    }
    for (_, end, _) in &segments {
        out.extend_from_slice(&end.to_be_bytes());
    }
    out.extend_from_slice(&0u16.to_be_bytes());
    for (start, _, _) in &segments {
        out.extend_from_slice(&start.to_be_bytes());
    }
    for (_, _, delta) in &segments {
        out.extend_from_slice(&delta.to_be_bytes());
    }
    for _ in &segments {
        out.extend_from_slice(&0u16.to_be_bytes());
    }
    Some(out)
}

fn largest_power_of_two_le(value: u16) -> u16 {
    let mut power = 1u16;
    while power <= value / 2 {
        power *= 2;
    }
    power
}

fn merge_head(base: &[u8], part: &[u8]) -> Result<Vec<u8>> {
    let mut head = base.to_vec();
    ensure!(head.len() >= 54, "short head table");
    head[8..12].copy_from_slice(&[0; 4]);
    for (offset, larger) in [(36, false), (38, false), (40, true), (42, true)] {
        let (a, b) = (i16_at(base, offset)?, i16_at(part, offset)?);
        let value = if larger { a.max(b) } else { a.min(b) };
        head[offset..offset + 2].copy_from_slice(&value.to_be_bytes());
    }
    head[50..52].copy_from_slice(&1i16.to_be_bytes());
    Ok(head)
}

fn merge_hhea(base: &[u8], metrics: &[(u16, i16)], glyphs: &[Vec<u8>]) -> Result<Vec<u8>> {
    let mut hhea = base.to_vec();
    ensure!(hhea.len() >= 36, "short hhea table");
    let mut advance_max = 0u16;
    let (mut min_lsb, mut min_rsb, mut max_extent) = (i16::MAX, i16::MAX, i16::MIN);
    for ((advance, lsb), glyph) in metrics.iter().zip(glyphs) {
        advance_max = advance_max.max(*advance);
        if glyph.len() < 10 {
            continue;
        }
        let (x_min, x_max) = (i16_at(glyph, 2)?, i16_at(glyph, 6)?);
        min_lsb = min_lsb.min(*lsb);
        let rsb = i32::from(*advance) - i32::from(*lsb) - (i32::from(x_max) - i32::from(x_min));
        min_rsb = min_rsb.min(rsb.clamp(i16::MIN as i32, i16::MAX as i32) as i16);
        let extent = i32::from(*lsb) + i32::from(x_max) - i32::from(x_min);
        max_extent = max_extent.max(extent.clamp(i16::MIN as i32, i16::MAX as i32) as i16);
    }
    hhea[10..12].copy_from_slice(&advance_max.to_be_bytes());
    if min_lsb != i16::MAX {
        hhea[12..14].copy_from_slice(&min_lsb.to_be_bytes());
        hhea[14..16].copy_from_slice(&min_rsb.to_be_bytes());
        hhea[16..18].copy_from_slice(&max_extent.to_be_bytes());
    }
    hhea[34..36].copy_from_slice(&(metrics.len() as u16).to_be_bytes());
    Ok(hhea)
}

fn merge_maxp(base: &[u8], part: &[u8], count: usize) -> Result<Vec<u8>> {
    let mut maxp = base.to_vec();
    maxp[4..6].copy_from_slice(&(count as u16).to_be_bytes());
    if maxp.len() >= 32 && part.len() >= 32 {
        for offset in (6..32).step_by(2) {
            let value = u16_at(base, offset)?.max(u16_at(part, offset)?);
            maxp[offset..offset + 2].copy_from_slice(&value.to_be_bytes());
        }
    }
    Ok(maxp)
}

/// Glyph names would have to be merged too; version 3 says there are none.
fn post_without_names(post: &[u8]) -> Result<Vec<u8>> {
    ensure!(post.len() >= 32, "short post table");
    let mut out = post[..32].to_vec();
    out[0..4].copy_from_slice(&0x0003_0000u32.to_be_bytes());
    Ok(out)
}

fn merge_os2(base: &[u8], part: Option<&[u8]>, cmap: &BTreeMap<u32, u16>) -> Result<Vec<u8>> {
    let mut os2 = base.to_vec();
    ensure!(os2.len() >= 68, "short OS/2 table");
    if let Some(part) = part.filter(|part| part.len() >= 58) {
        for offset in (42..58).step_by(4) {
            let value = u32_at(base, offset)? | u32_at(part, offset)?;
            os2[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
        }
    }
    let first = cmap.keys().next().copied().unwrap_or(0x20).min(0xFFFF) as u16;
    let last = cmap.keys().last().copied().unwrap_or(0x20).min(0xFFFF) as u16;
    os2[64..66].copy_from_slice(&first.to_be_bytes());
    os2[66..68].copy_from_slice(&last.to_be_bytes());
    Ok(os2)
}

/// Variation data is per glyph and refers to the glyph's own points, so the
/// added glyphs keep theirs. Both files must vary along the same axes with
/// the same shared tuples, which pieces of one variable font always do.
fn merge_gvar(base: &[u8], part: &[u8], base_count: usize, total: usize) -> Result<Vec<u8>> {
    let header = |gvar: &[u8]| -> Result<(u16, u16, usize, usize, bool, usize)> {
        Ok((
            u16_at(gvar, 4)?,
            u16_at(gvar, 6)?,
            u32_at(gvar, 8)? as usize,
            u16_at(gvar, 12)? as usize,
            u16_at(gvar, 14)? & 1 == 1,
            u32_at(gvar, 16)? as usize,
        ))
    };
    let (axes, tuples, tuples_at, base_glyphs, base_long, base_data) = header(base)?;
    let (part_axes, part_tuples, part_tuples_at, part_glyphs, part_long, part_data) = header(part)?;
    let tuple_bytes = tuples as usize * axes as usize * 2;
    ensure!(
        axes == part_axes
            && tuples == part_tuples
            && base.get(tuples_at..tuples_at + tuple_bytes)
                == part.get(part_tuples_at..part_tuples_at + tuple_bytes),
        "the variable files use different design spaces"
    );

    let slices = |gvar: &'_ [u8], glyphs: usize, long: bool, data: usize| -> Result<Vec<Vec<u8>>> {
        let offset = |index: usize| -> Result<usize> {
            Ok(if long {
                u32_at(gvar, 20 + index * 4)? as usize
            } else {
                u16_at(gvar, 20 + index * 2)? as usize * 2
            })
        };
        (0..glyphs)
            .map(|index| {
                let (start, end) = (data + offset(index)?, data + offset(index + 1)?);
                ensure!(start <= end && end <= gvar.len(), "gvar data overrun");
                Ok(gvar[start..end].to_vec())
            })
            .collect()
    };
    let mut variations = slices(base, base_glyphs, base_long, base_data)?;
    variations.resize(base_count, Vec::new());
    let part_variations = slices(part, part_glyphs, part_long, part_data)?;
    variations.extend(part_variations.into_iter().skip(1));
    variations.resize(total, Vec::new());

    let shared_at = 20 + (total + 1) * 4;
    let data_at = shared_at + tuple_bytes;
    let mut out = Vec::new();
    out.extend_from_slice(&1u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&axes.to_be_bytes());
    out.extend_from_slice(&tuples.to_be_bytes());
    out.extend_from_slice(&(shared_at as u32).to_be_bytes());
    out.extend_from_slice(&(total as u16).to_be_bytes());
    out.extend_from_slice(&1u16.to_be_bytes());
    out.extend_from_slice(&(data_at as u32).to_be_bytes());
    let mut offset = 0u32;
    for variation in &variations {
        out.extend_from_slice(&offset.to_be_bytes());
        offset += variation.len() as u32;
    }
    out.extend_from_slice(&offset.to_be_bytes());
    out.extend_from_slice(&base[tuples_at..tuples_at + tuple_bytes]);
    for variation in &variations {
        out.extend_from_slice(variation);
    }
    Ok(out)
}

fn build_sfnt(tables: BTreeMap<[u8; 4], Vec<u8>>) -> Result<Vec<u8>> {
    let count = tables.len() as u16;
    let power = largest_power_of_two_le(count);
    let mut out = Vec::new();
    out.extend_from_slice(&0x0001_0000u32.to_be_bytes());
    out.extend_from_slice(&count.to_be_bytes());
    out.extend_from_slice(&(power * 16).to_be_bytes());
    out.extend_from_slice(&(power.trailing_zeros() as u16).to_be_bytes());
    out.extend_from_slice(&(count * 16 - power * 16).to_be_bytes());

    let mut offset = 12 + tables.len() * 16;
    let mut body = Vec::new();
    let mut head_at = None;
    for (tag, data) in &tables {
        out.extend_from_slice(tag);
        out.extend_from_slice(&checksum(data).to_be_bytes());
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        if tag == b"head" {
            head_at = Some(offset);
        }
        body.extend_from_slice(data);
        let padded = (data.len() + 3) & !3;
        body.resize(body.len() + padded - data.len(), 0);
        offset += padded;
    }
    out.extend_from_slice(&body);
    let head_at = head_at.context("missing head table")?;
    let adjustment = 0xB1B0_AFBAu32.wrapping_sub(checksum(&out));
    out[head_at + 8..head_at + 12].copy_from_slice(&adjustment.to_be_bytes());
    Ok(out)
}

fn read_directory(data: &[u8]) -> Result<BTreeMap<[u8; 4], &[u8]>> {
    let count = u16_at(data, 4)? as usize;
    let mut tables = BTreeMap::new();
    for index in 0..count {
        let record = 12 + index * 16;
        let tag: [u8; 4] = data
            .get(record..record + 4)
            .context("table directory overrun")?
            .try_into()?;
        let offset = u32_at(data, record + 8)? as usize;
        let length = u32_at(data, record + 12)? as usize;
        let table = data
            .get(offset..offset + length)
            .with_context(|| format!("{} table overrun", String::from_utf8_lossy(&tag)))?;
        tables.insert(tag, table);
    }
    Ok(tables)
}

fn checksum(data: &[u8]) -> u32 {
    data.chunks(4).fold(0u32, |sum, chunk| {
        let mut word = [0u8; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}

fn u16_at(data: &[u8], offset: usize) -> Result<u16> {
    Ok(u16::from_be_bytes(
        data.get(offset..offset + 2)
            .context("table too short")?
            .try_into()?,
    ))
}

fn i16_at(data: &[u8], offset: usize) -> Result<i16> {
    Ok(u16_at(data, offset)? as i16)
}

fn u32_at(data: &[u8], offset: usize) -> Result<u32> {
    Ok(u32::from_be_bytes(
        data.get(offset..offset + 4)
            .context("table too short")?
            .try_into()?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::convert::decompress_to_sfnt;
    use crate::domain::FontFormat;

    fn fixture(name: &str) -> Vec<u8> {
        let raw = match name {
            "tt-core" => include_bytes!("fixtures/tt-core.woff2").as_slice(),
            "tt-ext" => include_bytes!("fixtures/tt-ext.woff2").as_slice(),
            "cff-core" => include_bytes!("fixtures/cff-core.woff2").as_slice(),
            "cff-ext" => include_bytes!("fixtures/cff-ext.woff2").as_slice(),
            _ => unreachable!(),
        };
        decompress_to_sfnt(raw, FontFormat::Woff2).unwrap()
    }

    #[test]
    fn joins_core_and_extension_into_one_font() {
        let core = fixture("tt-core");
        let ext = fixture("tt-ext");
        let merged = merge_sfnts(&core, &[ext.clone()]).unwrap();

        let face = Face::parse(&merged, 0).expect("the joined font parses");
        let core_face = Face::parse(&core, 0).unwrap();
        let ext_face = Face::parse(&ext, 0).unwrap();
        assert_eq!(
            face.number_of_glyphs(),
            core_face.number_of_glyphs() + ext_face.number_of_glyphs() - 1
        );
        for ch in ['A', 'z', '0', '~', 'é', 'ñ', 'ß', '©', '–', '…'] {
            let glyph = face
                .glyph_index(ch)
                .unwrap_or_else(|| panic!("{ch} is mapped"));
            let mut sink = Sink(0);
            face.outline_glyph(glyph, &mut sink)
                .unwrap_or_else(|| panic!("{ch} has an outline"));
            assert!(sink.0 > 0, "{ch} draws something");
        }
        // Base glyphs keep their IDs, so the base's layout tables stay valid.
        assert_eq!(face.glyph_index('A'), core_face.glyph_index('A'));
        // An accented letter built from components still advances like the original.
        let e_acute = face.glyph_index('é').unwrap();
        let original = ext_face.glyph_index('é').unwrap();
        assert_eq!(
            face.glyph_hor_advance(e_acute),
            ext_face.glyph_hor_advance(original)
        );
        assert_eq!(checksum(&merged), 0xB1B0_AFBA);
    }

    #[test]
    fn refuses_outlines_it_cannot_join() {
        let error = merge_sfnts(&fixture("cff-core"), &[fixture("cff-ext")]).unwrap_err();
        assert!(error.to_string().contains("first file") || error.to_string().contains("CFF"));
    }

    #[test]
    fn refuses_two_copies_of_the_same_characters() {
        let core = fixture("tt-core");
        assert!(merge_sfnts(&core, &[core.clone()]).is_err());
    }

    struct Sink(usize);
    impl ttf_parser::OutlineBuilder for Sink {
        fn move_to(&mut self, _: f32, _: f32) {
            self.0 += 1;
        }
        fn line_to(&mut self, _: f32, _: f32) {
            self.0 += 1;
        }
        fn quad_to(&mut self, _: f32, _: f32, _: f32, _: f32) {
            self.0 += 1;
        }
        fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) {
            self.0 += 1;
        }
        fn close(&mut self) {}
    }
}
