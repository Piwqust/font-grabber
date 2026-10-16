//! Turns what a page loads into the faces a person would recognise.
//!
//! Sites rarely name fonts for people. A foundry may declare `bng-rg-A` and
//! `bng-rg-B` for one face of ABC Bingo, served as a "core" and an "ext" file,
//! and a font service splits every face into files per script behind
//! `unicode-range`. Shown as found, one typeface becomes a page of cryptic,
//! half-empty entries. This pass does two things:
//!
//! 1. When the CSS name is an internal alias and the file name is a real
//!    name (`ABCBingoCondensed-Bold.woff2`), the face is named from the file.
//! 2. Files that are pieces of one face are joined into one candidate whose
//!    extra files ride along in `parts`, to be merged into one font on export.

use std::collections::HashMap;

use crate::domain::{FontCandidate, FontPart};

/// More pieces than this is a CJK font cut into slices for the web; joining
/// hundreds of downloads is not what anyone pressing Download expects.
const MAX_PARTS: usize = 160;

pub fn assemble(fonts: Vec<FontCandidate>) -> Vec<FontCandidate> {
    let fonts = fonts
        .into_iter()
        .map(|font| {
            let named_by_css = !looks_like_alias(&font.family);
            (name_from_file(font), named_by_css)
        })
        .collect();
    let fonts = drop_duplicate_files(fonts);
    join_pieces(fonts)
}

/* --- Names ------------------------------------------------------------------ */

fn name_from_file(mut font: FontCandidate) -> FontCandidate {
    if !looks_like_alias(&font.family) {
        return font;
    }
    let Some(name) = font
        .sources
        .first()
        .and_then(|source| file_stem(&source.url))
        .and_then(|stem| parse_file_name(&stem))
    else {
        return font;
    };
    let alias = std::mem::replace(&mut font.family, name.family);
    if alias != "(Unknown)" {
        font.css_family = Some(alias);
    }
    // An alias carries no weight of its own: the CSS says 400 for every file.
    // The file name is the better witness, unless the face is variable.
    if !font.variable && !font.weight.contains(' ') {
        if let Some(weight) = name.weight {
            if font.weight == "400" || font.weight.is_empty() {
                font.weight = weight.to_string();
            }
        }
        if name.italic && font.style == "normal" {
            font.style = "italic".to_string();
        }
    }
    font
}

/// CSS family names that are bookkeeping rather than names: empty, a part
/// marker such as `-A`/`-ext`, or a row of short abbreviations (`arz-sns-rg`).
pub(crate) fn looks_like_alias(family: &str) -> bool {
    let family = family.trim().trim_matches(|ch| ch == '"' || ch == '\'');
    if family.is_empty() || family == "(Unknown)" {
        return true;
    }
    if part_suffix(family).is_some() {
        return true;
    }
    let tokens: Vec<&str> = family
        .split(|ch: char| ch == '-' || ch == '_' || ch.is_whitespace())
        .filter(|token| !token.is_empty())
        .collect();
    tokens.len() >= 2
        && tokens
            .iter()
            .all(|token| token.len() <= 4 && token.chars().all(|ch| ch.is_ascii_lowercase()))
}

/// `bng-rg-A` -> ("bng-rg", "a"). Only short, unambiguous markers count, so a
/// real family that ends in a letter (`Font B`) needs a separator and a stem
/// that is itself an abbreviation before it is treated as a piece.
fn part_suffix(family: &str) -> Option<(String, String)> {
    let lower = family.to_ascii_lowercase();
    // "Extra" and "Extended" are real style words (GT Flaire Basic Extra), so
    // only markers no typeface would use as a name count.
    for marker in ["core", "ext", "base"] {
        for separator in ['-', '_'] {
            if let Some(stem) = lower.strip_suffix(&format!("{separator}{marker}")) {
                return Some((stem.to_string(), marker.to_string()));
            }
        }
    }
    let (stem, last) = lower.rsplit_once(['-', '_'])?;
    let is_marker = (last.len() == 1 && last.chars().all(|ch| ch.is_ascii_alphanumeric()))
        || (last.starts_with("part") && last[4..].chars().all(|ch| ch.is_ascii_digit()));
    let stem_is_code = stem
        .split(['-', '_'])
        .all(|token| !token.is_empty() && token.len() <= 6 && !token.contains(' '));
    (is_marker && stem_is_code).then(|| (stem.to_string(), last.to_string()))
}

fn file_stem(url: &str) -> Option<String> {
    if url.starts_with("data:") {
        return None;
    }
    let path = url.split(['?', '#']).next()?;
    let name = path.rsplit('/').next()?;
    let name = percent_decode(name);
    let mut stem = name.as_str();
    for extension in [".woff2", ".woff", ".ttf", ".otf", ".eot", ".svg"] {
        if stem.to_ascii_lowercase().ends_with(extension) {
            stem = &stem[..stem.len() - extension.len()];
            break;
        }
    }
    (!stem.is_empty()).then(|| stem.to_string())
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Debug, PartialEq)]
struct FileName {
    family: String,
    weight: Option<u16>,
    italic: bool,
}

const STYLE_WORDS: &[(&str, Option<u16>)] = &[
    ("hairline", Some(100)),
    ("thin", Some(100)),
    ("extralight", Some(200)),
    ("ultralight", Some(200)),
    ("light", Some(300)),
    ("book", Some(400)),
    ("regular", Some(400)),
    ("normal", Some(400)),
    ("roman", Some(400)),
    ("medium", Some(500)),
    ("semibold", Some(600)),
    ("demibold", Some(600)),
    ("bold", Some(700)),
    ("extrabold", Some(800)),
    ("ultrabold", Some(800)),
    ("heavy", Some(800)),
    ("black", Some(900)),
    ("ultra", Some(900)),
    ("italic", None),
    ("oblique", None),
];

/// `ABCBingoCondensed-SemiBoldItalic` -> family "ABC Bingo Condensed", 600, italic.
/// Hashed or numbered file names (`5ce348bf30bf5439.27spqqad3wyeo`) are refused.
fn parse_file_name(stem: &str) -> Option<FileName> {
    let stem = stem.split('.').next().unwrap_or(stem);
    let letters = stem.chars().filter(|ch| ch.is_alphabetic()).count();
    let digits = stem.chars().filter(|ch| ch.is_ascii_digit()).count();
    if letters < 3 || digits > 4 || looks_hashed(stem) {
        return None;
    }

    let mut tokens: Vec<String> = stem
        .split(['-', '_', ' '])
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .collect();
    let mut weight = None;
    let mut italic = false;
    // Style words sit at the end: "Family-Bold", "Family-BoldItalic", "Family_Italic".
    while tokens.len() > 1 {
        let words = split_camel(tokens.last().unwrap());
        let joined: Vec<String> = join_style_words(&words);
        let styles: Option<Vec<&(&str, Option<u16>)>> = joined
            .iter()
            .map(|word| {
                STYLE_WORDS
                    .iter()
                    .find(|(name, _)| name.eq_ignore_ascii_case(word))
            })
            .collect();
        let Some(styles) = styles else { break };
        for (name, value) in styles {
            if *name == "italic" || *name == "oblique" {
                italic = true;
            } else if weight.is_none() {
                weight = *value;
            }
        }
        tokens.pop();
    }

    let family = tokens
        .iter()
        .flat_map(|token| split_camel(token))
        .collect::<Vec<_>>()
        .join(" ");
    (family.chars().filter(|ch| ch.is_alphabetic()).count() >= 3).then_some(FileName {
        family,
        weight,
        italic,
    })
}

/// Long runs that mix letters and digits, or that have no vowels, are hashes.
fn looks_hashed(stem: &str) -> bool {
    stem.split(['-', '_', '.']).any(|token| {
        let has_digit = token.chars().any(|ch| ch.is_ascii_digit());
        let has_letter = token.chars().any(|ch| ch.is_ascii_alphabetic());
        let vowels = token
            .chars()
            .filter(|ch| "aeiouyAEIOUY".contains(*ch))
            .count();
        (token.len() >= 8 && has_digit && has_letter)
            || (token.len() >= 6 && vowels == 0 && has_letter)
    })
}

/// "ABCBingoCondensed" -> ["ABC", "Bingo", "Condensed"]; "SemiBold" -> ["Semi", "Bold"].
fn split_camel(token: &str) -> Vec<String> {
    let chars: Vec<char> = token.chars().collect();
    let mut words = Vec::new();
    let mut current = String::new();
    for (index, &ch) in chars.iter().enumerate() {
        let previous = index.checked_sub(1).map(|i| chars[i]);
        let next = chars.get(index + 1).copied();
        let boundary = match previous {
            Some(prev) if ch.is_uppercase() => {
                prev.is_lowercase()
                    || prev.is_ascii_digit()
                    || (prev.is_uppercase() && next.is_some_and(char::is_lowercase))
            }
            _ => false,
        };
        if boundary && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        current.push(ch);
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

/// ["Semi", "Bold", "Italic"] -> ["semibold", "italic"]: prefixes that are not
/// style words on their own join the word after them.
fn join_style_words(words: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut pending = String::new();
    for word in words {
        let lower = word.to_ascii_lowercase();
        if matches!(lower.as_str(), "semi" | "demi" | "extra" | "ultra" | "x") && pending.is_empty()
        {
            pending = if lower == "x" { "extra".into() } else { lower };
            continue;
        }
        out.push(format!("{pending}{lower}"));
        pending.clear();
    }
    if !pending.is_empty() {
        out.push(pending);
    }
    out
}

/* --- Duplicates ------------------------------------------------------------- */

/// The same file reached twice (from the stylesheet and from the browser, one
/// named by the page and one only by its file) is one face; the page's own
/// name wins over one read off the file.
fn drop_duplicate_files(fonts: Vec<(FontCandidate, bool)>) -> Vec<FontCandidate> {
    let mut by_url: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<(FontCandidate, bool)> = Vec::new();
    for (font, named_by_css) in fonts {
        let Some(url) = font.sources.first().map(|source| source.url.clone()) else {
            out.push((font, named_by_css));
            continue;
        };
        match by_url.get(&url) {
            Some(&index) if out[index].0.unicode_range == font.unicode_range => {
                let kept = &mut out[index];
                if named_by_css && !kept.1 {
                    let scripts = std::mem::take(&mut kept.0.scripts);
                    *kept = (font, true);
                    kept.0.scripts.extend(scripts);
                } else {
                    kept.0.scripts.extend(font.scripts);
                }
                kept.0.scripts.sort();
                kept.0.scripts.dedup();
            }
            _ => {
                by_url.insert(url, out.len());
                out.push((font, named_by_css));
            }
        }
    }
    out.into_iter().map(|(font, _)| font).collect()
}

/* --- Pieces ----------------------------------------------------------------- */

fn join_pieces(fonts: Vec<FontCandidate>) -> Vec<FontCandidate> {
    let mut groups: Vec<Vec<FontCandidate>> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for font in fonts {
        let key = format!(
            "{}|{}|{}|{}",
            font.family.to_lowercase(),
            font.weight,
            font.style,
            font.stretch.as_deref().unwrap_or("")
        );
        match index.get(&key) {
            Some(&at) => groups[at].push(font),
            None => {
                index.insert(key, groups.len());
                groups.push(vec![font]);
            }
        }
    }

    let mut out = Vec::new();
    for group in groups {
        if group.len() == 1 {
            out.extend(group);
            continue;
        }
        for cluster in clusters(group) {
            if cluster.len() > MAX_PARTS {
                out.extend(cluster);
            } else {
                out.push(join(cluster));
            }
        }
    }
    out
}

/// Splits a group of same-named faces into sets of pieces. Two files are
/// pieces of one face when CSS gives them different character ranges, when
/// they are the same file name in different folders (`core/` and `ext/`), or
/// when their aliases differ only by a part marker (`-A`, `-B`).
fn clusters(group: Vec<FontCandidate>) -> Vec<Vec<FontCandidate>> {
    let count = group.len();
    let mut parent: Vec<usize> = (0..count).collect();
    fn root(parent: &mut [usize], mut node: usize) -> usize {
        while parent[node] != node {
            parent[node] = parent[parent[node]];
            node = parent[node];
        }
        node
    }
    for left in 0..count {
        for right in left + 1..count {
            if are_pieces(&group[left], &group[right]) {
                let (a, b) = (root(&mut parent, left), root(&mut parent, right));
                parent[b] = a;
            }
        }
    }
    let mut sets: Vec<(usize, Vec<FontCandidate>)> = Vec::new();
    for (node, font) in group.into_iter().enumerate() {
        let id = root(&mut parent, node);
        match sets.iter_mut().find(|(set, _)| *set == id) {
            Some((_, members)) => members.push(font),
            None => sets.push((id, vec![font])),
        }
    }
    sets.into_iter().map(|(_, members)| members).collect()
}

fn are_pieces(left: &FontCandidate, right: &FontCandidate) -> bool {
    if let (Some(a), Some(b)) = (&left.unicode_range, &right.unicode_range) {
        return a != b;
    }
    let urls = |font: &FontCandidate| font.sources.first().map(|source| source.url.clone());
    let (Some(left_url), Some(right_url)) = (urls(left), urls(right)) else {
        return false;
    };
    if left_url == right_url {
        return false;
    }
    // One file name in two folders that name the split (`core/` and `ext/`).
    // A copy of the whole font elsewhere on the site (`css/fonts/`) is not a
    // piece of it.
    let same_file = match (file_stem(&left_url), file_stem(&right_url)) {
        (Some(a), Some(b)) => {
            a.eq_ignore_ascii_case(&b)
                && matches!(
                    (part_folder(&left_url), part_folder(&right_url)),
                    (Some(x), Some(y)) if x != y
                )
        }
        _ => false,
    };
    let sibling_aliases = match (
        left.css_family.as_deref().and_then(part_suffix),
        right.css_family.as_deref().and_then(part_suffix),
    ) {
        (Some((a, x)), Some((b, y))) => a == b && x != y,
        _ => false,
    };
    same_file || sibling_aliases
}

fn part_folder(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let folder = path.rsplit('/').nth(1)?.to_ascii_lowercase();
    const MARKERS: &[&str] = &[
        "core",
        "ext",
        "extended",
        "extension",
        "base",
        "basic",
        "extra",
        "latin",
        "latin-ext",
        "subset",
        "subsets",
        "part1",
        "part2",
        "a",
        "b",
    ];
    MARKERS.contains(&folder.as_str()).then_some(folder)
}

fn join(mut members: Vec<FontCandidate>) -> FontCandidate {
    if members.len() == 1 {
        return members.pop().unwrap();
    }
    // The base is the piece with basic Latin: it holds the layout features
    // that matter most, and its glyph IDs are kept as they are.
    members.sort_by_key(|font| std::cmp::Reverse(base_score(font)));
    let mut base = members.remove(0);
    for piece in members {
        base.scripts.extend(piece.scripts.iter().copied());
        base.variable |= piece.variable;
        base.parts.push(FontPart {
            sources: piece.sources,
            unicode_range: piece.unicode_range,
        });
    }
    base.scripts.sort();
    base.scripts.dedup();
    // The joined face covers every range, so no single range describes it.
    base.unicode_range = None;
    base
}

fn base_score(font: &FontCandidate) -> u8 {
    let url = font
        .sources
        .first()
        .map(|source| source.url.to_ascii_lowercase())
        .unwrap_or_default();
    let alias_marker = font
        .css_family
        .as_deref()
        .and_then(part_suffix)
        .map(|(_, marker)| marker);
    let covers_latin = font
        .unicode_range
        .as_deref()
        .is_some_and(|range| range_covers(range, 0x41));
    u8::from(covers_latin) * 4
        + u8::from(url.contains("/core/") || url.contains("/base/") || url.contains("latin")) * 2
        + u8::from(matches!(
            alias_marker.as_deref(),
            Some("a" | "1" | "core" | "base")
        ))
}

fn range_covers(range: &str, point: u32) -> bool {
    range.split(',').any(|part| {
        let part = part.trim().trim_start_matches(['U', 'u', '+']);
        if part.contains('?') {
            let low = u32::from_str_radix(&part.replace('?', "0"), 16);
            let high = u32::from_str_radix(&part.replace('?', "F"), 16);
            return matches!((low, high), (Ok(low), Ok(high)) if low <= point && point <= high);
        }
        let (start, end) = part.split_once('-').unwrap_or((part, part));
        matches!(
            (u32::from_str_radix(start, 16), u32::from_str_radix(end, 16)),
            (Ok(start), Ok(end)) if start <= point && point <= end
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{FontFormat, FontSource, ScanSource};

    fn face(family: &str, url: &str, range: Option<&str>) -> FontCandidate {
        FontCandidate {
            id: format!("{family}|{url}"),
            family: family.into(),
            style: "normal".into(),
            weight: "400".into(),
            stretch: None,
            sources: vec![FontSource {
                url: url.into(),
                format: FontFormat::Woff2,
            }],
            unicode_range: range.map(str::to_string),
            scripts: Vec::new(),
            variable: false,
            scan_source: ScanSource::BrowserCss,
            parts: Vec::new(),
            css_family: None,
        }
    }

    #[test]
    fn foundry_aliases_become_one_named_face() {
        let fonts = assemble(vec![
            face(
                "bng-rg-A",
                "https://cdn.example/webfonts/core/ABCBingo-Regular.woff2",
                None,
            ),
            face(
                "bng-rg-B",
                "https://cdn.example/webfonts/ext/ABCBingo-Regular.woff2",
                None,
            ),
            face(
                "bng-cn-bd-A",
                "https://cdn.example/webfonts/core/ABCBingoCondensed-Bold.woff2",
                None,
            ),
            face(
                "bng-cn-bd-B",
                "https://cdn.example/webfonts/ext/ABCBingoCondensed-Bold.woff2",
                None,
            ),
        ]);
        assert_eq!(fonts.len(), 2);
        let regular = fonts.iter().find(|f| f.family == "ABC Bingo").unwrap();
        assert_eq!(regular.css_family.as_deref(), Some("bng-rg-A"));
        assert!(regular.sources[0].url.contains("/core/"));
        assert_eq!(regular.parts.len(), 1);
        assert!(regular.parts[0].sources[0].url.contains("/ext/"));
        let bold = fonts
            .iter()
            .find(|f| f.family == "ABC Bingo Condensed")
            .unwrap();
        assert_eq!(bold.weight, "700");
    }

    #[test]
    fn unicode_range_subsets_join_with_latin_as_the_base() {
        let fonts = assemble(vec![
            face("Geist Mono", "https://x/a1.woff2", Some("U+0400-045F")),
            face(
                "Geist Mono",
                "https://x/b2.woff2",
                Some("U+0000-00FF,U+0131"),
            ),
            face("Geist Mono", "https://x/c3.woff2", Some("U+1EA0-1EF9")),
        ]);
        assert_eq!(fonts.len(), 1);
        assert_eq!(fonts[0].sources[0].url, "https://x/b2.woff2");
        assert_eq!(fonts[0].parts.len(), 2);
        assert!(fonts[0].unicode_range.is_none());
    }

    #[test]
    fn a_whole_copy_elsewhere_on_the_site_is_not_a_piece() {
        let fonts = assemble(vec![
            face(
                "mnt-mn-rg-A",
                "https://x/webfonts/core/ABCMonumentGroteskMono-Regular.woff2",
                None,
            ),
            face(
                "mnt-mn-rg-B",
                "https://x/webfonts/ext/ABCMonumentGroteskMono-Regular.woff2",
                None,
            ),
            face(
                "(Unknown)",
                "https://x/css/fonts/ABCMonumentGroteskMono-Regular.woff2",
                None,
            ),
            face(
                "Monument Grotesk Mono",
                "https://x/css/fonts/ABCMonumentGroteskMono-Regular.woff2",
                None,
            ),
        ]);
        let split = fonts
            .iter()
            .find(|f| f.family == "ABC Monument Grotesk Mono")
            .unwrap();
        assert_eq!(split.parts.len(), 1);
        let copy = fonts
            .iter()
            .find(|f| f.sources[0].url.contains("/css/"))
            .unwrap();
        assert_eq!(copy.family, "Monument Grotesk Mono");
        assert_eq!(fonts.len(), 2);
    }

    #[test]
    fn real_names_and_separate_weights_are_left_alone() {
        let mut bold = face("Inter", "https://x/Inter-Bold.woff2", None);
        bold.weight = "700".into();
        let fonts = assemble(vec![
            face("Inter", "https://x/Inter-Regular.woff2", None),
            bold,
        ]);
        assert_eq!(fonts.len(), 2);
        assert!(fonts
            .iter()
            .all(|f| f.family == "Inter" && f.parts.is_empty()));
    }

    #[test]
    fn two_different_files_with_one_name_stay_two_faces() {
        let fonts = assemble(vec![
            face("Brand", "https://x/brand-one.woff2", None),
            face("Brand", "https://y/brand-two.woff2", None),
        ]);
        assert_eq!(fonts.len(), 2);
    }

    #[test]
    fn unnamed_files_are_named_from_the_file_and_kept_apart() {
        let fonts = assemble(vec![
            face(
                "(Unknown)",
                "https://x/css/fonts/ABCMonumentGrotesk-Regular.woff2",
                None,
            ),
            face(
                "(Unknown)",
                "https://x/css/fonts/ABCMonumentGroteskMono-Regular.woff2",
                None,
            ),
        ]);
        let names: Vec<_> = fonts.iter().map(|f| f.family.as_str()).collect();
        assert!(names.contains(&"ABC Monument Grotesk"));
        assert!(names.contains(&"ABC Monument Grotesk Mono"));
    }

    #[test]
    fn hashed_file_names_never_become_names() {
        assert!(parse_file_name("5ce348bf30bf5439.27spqqad3wyeo").is_none());
        assert!(parse_file_name("a1b2c3d4e5").is_none());
        assert_eq!(
            parse_file_name("GTMechanik-SemiBoldItalic").unwrap(),
            FileName {
                family: "GT Mechanik".into(),
                weight: Some(600),
                italic: true
            }
        );
    }

    #[test]
    fn alias_detection_spares_real_names() {
        for alias in [
            "arz-sns-rg-A",
            "bng-rg-B",
            "(Unknown)",
            "font-core",
            "ee-te-bd",
        ] {
            assert!(looks_like_alias(alias), "{alias}");
        }
        for name in [
            "Inter",
            "Geist Mono",
            "ABC Diatype",
            "Font B",
            "Plex-Mono",
            "GT Eesti",
        ] {
            assert!(!looks_like_alias(name), "{name}");
        }
    }
}
