"""Render ProxyHubb store/toolbar icons from the wordmark lockup."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT_PATH = Path(__file__).resolve().parent / ".fonts" / "Outfit-SemiBold.ttf"
ICON_DIR = ROOT / "src" / "icons"
STORE_DIR = ROOT / "store-assets"

BG = (10, 11, 10, 255)
WHITE = (254, 254, 254, 255)
LIME = (138, 242, 14, 255)
MASTER = 1024


def load_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size=size)


def text_size(font: ImageFont.FreeTypeFont, text: str, tracking: float) -> tuple[float, int, int]:
    if not text:
        return 0.0, 0, 0
    width = 0.0
    min_top = 10**9
    max_bottom = 0
    for i, ch in enumerate(text):
        left, top, right, bottom = font.getbbox(ch)
        width += (right - left) if i == 0 else font.getlength(ch)
        if i < len(text) - 1:
            width += tracking
        min_top = min(min_top, top)
        max_bottom = max(max_bottom, bottom)
    return width, min_top, max_bottom


def blit_glyph(canvas: Image.Image, font: ImageFont.FreeTypeFont, ch: str, xy: tuple[float, float], fill: tuple[int, int, int, int]) -> None:
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.text(xy, ch, font=font, fill=fill)
    canvas.alpha_composite(layer)


def blit_split_y(
    canvas: Image.Image,
    font: ImageFont.FreeTypeFont,
    xy: tuple[float, float],
    split: float = 0.58,
) -> None:
    left, top, right, bottom = font.getbbox("y")
    pad = 10
    gw = (right - left) + pad * 2
    gh = (bottom - top) + pad * 2
    glyph = Image.new("RGBA", (max(1, gw), max(1, gh)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glyph)
    draw.text((pad - left, pad - top), "y", font=font, fill=(255, 255, 255, 255))

    cut = pad + (right - left) * split
    px = glyph.load()
    w, h = glyph.size
    colored = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out = colored.load()
    for gy in range(h):
        for gx in range(w):
            a = px[gx, gy][3]
            if a == 0:
                continue
            t = (gx - (cut - 1.2)) / 2.4
            t = 0.0 if t < 0 else 1.0 if t > 1 else t
            r = round(WHITE[0] * (1 - t) + LIME[0] * t)
            g = round(WHITE[1] * (1 - t) + LIME[1] * t)
            b = round(WHITE[2] * (1 - t) + LIME[2] * t)
            out[gx, gy] = (r, g, b, a)

    dx, dy = xy
    canvas.alpha_composite(colored, (round(dx + left - pad), round(dy + top - pad)))


def draw_tracked(
    canvas: Image.Image,
    font: ImageFont.FreeTypeFont,
    text: str,
    origin: tuple[float, float],
    tracking: float,
    fill: tuple[int, int, int, int] | None,
    split_y: bool,
) -> None:
    x, y = origin
    for i, ch in enumerate(text):
        if split_y and ch == "y":
            blit_split_y(canvas, font, (x, y))
        else:
            blit_glyph(canvas, font, ch, (x, y), fill or WHITE)
        advance = font.getlength(ch)
        if i < len(text) - 1:
            advance += tracking
        x += advance


def radial_glow(size: int) -> Image.Image:
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = glow.load()
    cx = cy = size / 2
    inner, outer = size * 0.08, size * 0.46
    for y in range(size):
        dy = y - cy
        for x in range(size):
            d = (x - cx) ** 2 + dy * dy
            d = d ** 0.5
            if d >= outer:
                continue
            if d <= inner:
                a = 42
            else:
                t = (d - inner) / (outer - inner)
                a = int(42 * (1 - t) * (1 - t))
            px[x, y] = (LIME[0], LIME[1], LIME[2], a)
    return glow


def render_stacked(size: int = MASTER) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG)
    canvas.alpha_composite(radial_glow(size))

    font_size = int(size * 0.222)
    font = load_font(font_size)
    tracking = -font_size * 0.038
    line_gap = int(font_size * 0.16)

    proxy_w, proxy_top, proxy_bot = text_size(font, "proxy", tracking)
    hubb_w, hubb_top, hubb_bot = text_size(font, "hubb", tracking)
    block_h = (proxy_bot - proxy_top) + line_gap + (hubb_bot - hubb_top)
    start_y = (size - block_h) / 2 - proxy_top
    proxy_x = (size - proxy_w) / 2
    hubb_x = (size - hubb_w) / 2
    hubb_y = start_y + (proxy_bot - proxy_top) + line_gap

    bloom = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_tracked(bloom, font, "hubb", (hubb_x, hubb_y), tracking, LIME, split_y=False)
    bloom = bloom.filter(ImageFilter.GaussianBlur(radius=size * 0.022))
    bloom.putalpha(bloom.getchannel("A").point(lambda a: int(a * 0.32)))
    canvas.alpha_composite(bloom)

    draw_tracked(canvas, font, "proxy", (proxy_x, start_y), tracking, WHITE, split_y=True)
    draw_tracked(canvas, font, "hubb", (hubb_x, hubb_y), tracking, LIME, split_y=False)
    return canvas


def render_monogram(size: int = MASTER) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG)
    canvas.alpha_composite(radial_glow(size))
    font = load_font(int(size * 0.52))
    tracking = -font.size * 0.08
    width, top, bottom = text_size(font, "ph", tracking)
    x = (size - width) / 2
    y = (size - (bottom - top)) / 2 - top
    bloom = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_tracked(bloom, font, "ph", (x, y), tracking, LIME, split_y=False)
    bloom = bloom.filter(ImageFilter.GaussianBlur(radius=size * 0.03))
    bloom.putalpha(bloom.getchannel("A").point(lambda a: int(a * 0.4)))
    canvas.alpha_composite(bloom)
    draw_tracked(canvas, font, "p", (x, y), tracking, WHITE, split_y=False)
    draw_tracked(canvas, font, "h", (x + font.getlength("p") + tracking, y), tracking, LIME, split_y=False)
    return canvas


def save_rgb(img: Image.Image, path: Path, size: int) -> None:
    out = img.resize((size, size), Image.Resampling.LANCZOS).convert("RGB")
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path, "PNG", optimize=True)
    print(f"wrote {path} {size}x{size}")


def main() -> None:
    if not FONT_PATH.exists():
        raise SystemExit(f"missing font: {FONT_PATH}")
    stacked = render_stacked()
    mono = render_monogram()
    save_rgb(stacked, ICON_DIR / "icon128.png", 128)
    save_rgb(stacked, ICON_DIR / "icon48.png", 48)
    save_rgb(mono, ICON_DIR / "icon32.png", 32)
    save_rgb(mono, ICON_DIR / "icon16.png", 16)
    save_rgb(stacked, STORE_DIR / "icon-128.png", 128)


if __name__ == "__main__":
    main()
