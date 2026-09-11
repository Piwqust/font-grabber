"""Rebuild Fount's vector master. Requires fontTools with WOFF2 support."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parents[1]
assets = root / 'core/src/web/assets'
# The upright is x=104..196. All joins use shared endpoints and tangents.
# No raster tracing, stroke expansion, filter, clipping or external resource.
letter = 'M48 32H268C285.673112 32 300 46.326888 300 64V70C288 64 277 62 260 62H252C216 62 196 84 196 120V192C196 228 216 248 252 248H300V284H252C216 284 196 306 196 342V376C196 420 218 440 262 446V452H48V446C88 442 104 420 104 376V112C104 68 88 44 48 38Z'
fold = 'M268 32C285.673112 32 300 46.326888 300 64V118C300 140.091390 317.908610 158 340 158H404C402 144 394 134 384 124L302 42C293 35 281 32 268 32Z'
cursor = 'M338 180C338 176 342 174 345 177L430 240C434 243 433 248 428 249L398 256L418 295C420 299 418 303 414 305L402 311C398 313 394 311 392 307L374 270L348 292C344 295 340 293 340 288Z'

def symbol(mono=False):
    return f'<path fill="#202020" d="{letter}"/><path fill="{"#202020" if mono else "#548fe7"}" d="{fold}"/><path fill="#202020" d="{cursor}"/>'

def svg(viewbox, body, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" role="img" aria-labelledby="title"><title id="title">{title}</title>{body}</svg>\n'

(assets / 'fount-mark.svg').write_text(svg('0 0 480 480', symbol(), 'Fount'), encoding='utf-8')
(assets / 'fount-mark-mono.svg').write_text(svg('0 0 480 480', symbol(True), 'Fount monochrome'), encoding='utf-8')
(root / 'core/src/web/favicon.svg').write_text(svg('0 0 480 480', symbol(), 'Fount'), encoding='utf-8')

# Convert the bundled, licensed Geist SemiBold glyphs into paths. No live SVG text.
font = TTFont(assets / 'geist-600.woff2')
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
units = font['head'].unitsPerEm
advance = sum(glyphs[cmap[ord(char)]].width for char in 'Fount')
scale = 456 / advance
paths = []
x = 0
for char in 'Fount':
    name = cmap[ord(char)]
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, 32+x*scale, 614)))
    paths.append(f'<path d="{pen.getCommands()}"/>')
    x += glyphs[name].width
word = '<g fill="#202020">' + ''.join(paths) + '</g>'
(assets / 'fount-logo.svg').write_text(svg('0 0 520 660', f'<g transform="translate(20 12)">{symbol()}</g>{word}', 'Fount logo'), encoding='utf-8')
print('Generated 4 self-contained SVG assets, with outlined lockup lettering.')
