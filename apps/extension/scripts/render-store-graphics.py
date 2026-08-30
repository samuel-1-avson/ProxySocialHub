"""Render Chrome Web Store screenshot (RGB) and promo tiles."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT_BOLD = Path(__file__).resolve().parent / ".fonts" / "Outfit-SemiBold.ttf"
FONT_MED = Path(__file__).resolve().parent / ".fonts" / "Outfit-Medium.ttf"
STORE = ROOT / "store-assets"

BG = (10, 11, 10, 255)
WHITE = (254, 254, 254, 255)
LIME = (138, 242, 14, 255)
MUTED = (176, 186, 176, 255)

spec = importlib.util.spec_from_file_location(
    "store_icon", Path(__file__).with_name("render-store-icon.py")
)
icons = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(icons)


def load(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def radial_rect(width: int, height: int) -> Image.Image:
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    px = glow.load()
    cx, cy = width / 2, height / 2
    outer = max(width, height) * 0.42
    inner = outer * 0.18
    for y in range(height):
        dy = y - cy
        for x in range(width):
            d = ((x - cx) ** 2 + dy * dy) ** 0.5
            if d >= outer:
                continue
            t = 0.0 if d <= inner else (d - inner) / (outer - inner)
            a = int(40 * (1 - t) * (1 - t))
            px[x, y] = (LIME[0], LIME[1], LIME[2], a)
    return glow


def fit_wordmark(max_width: int, start: int) -> tuple[ImageFont.FreeTypeFont, float, float, int, int]:
    size = start
    while size >= 18:
        font = load(FONT_BOLD, size)
        tracking = -size * 0.04
        width, top, bot = icons.text_size(font, "proxyhubb", tracking)
        if width <= max_width:
            return font, tracking, width, top, bot
        size -= 2
    font = load(FONT_BOLD, 18)
    tracking = -18 * 0.04
    width, top, bot = icons.text_size(font, "proxyhubb", tracking)
    return font, tracking, width, top, bot


def draw_tag(canvas: Image.Image, text: str, font: ImageFont.FreeTypeFont, y: float) -> None:
    draw = ImageDraw.Draw(canvas)
    left, top, right, bottom = font.getbbox(text)
    x = (canvas.size[0] - (right - left)) / 2 - left
    draw.text((x, y), text, font=font, fill=MUTED)


def render_small() -> Image.Image:
    w, h = 1760, 1120
    canvas = Image.new("RGBA", (w, h), BG)
    canvas.alpha_composite(radial_rect(w, h))
    font, tracking, tw, top, bot = fit_wordmark(int(w * 0.82), 210)
    x = (w - tw) / 2
    y = h * 0.30 - (bot + top) / 2
    bloom = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    hubb_x = x + tw - icons.text_size(font, "hubb", tracking)[0]
    icons.draw_tracked(bloom, font, "hubb", (hubb_x, y), tracking, LIME, False)
    bloom = bloom.filter(ImageFilter.GaussianBlur(radius=18))
    bloom.putalpha(bloom.getchannel("A").point(lambda a: int(a * 0.28)))
    canvas.alpha_composite(bloom)
    icons.draw_tracked(canvas, font, "proxyhubb", (x, y), tracking, WHITE, True)
    tag = load(FONT_MED, 52)
    draw_tag(canvas, "HTTP CONNECT  ·  not a VPN", tag, y + (bot - top) + 48)
    return canvas.resize((440, 280), Image.Resampling.LANCZOS).convert("RGB")


def render_marquee() -> Image.Image:
    w, h = 2800, 1120
    canvas = Image.new("RGBA", (w, h), BG)
    canvas.alpha_composite(radial_rect(w, h))
    font, tracking, tw, top, bot = fit_wordmark(int(w * 0.78), 280)
    x = (w - tw) / 2
    y = h * 0.34 - (bot + top) / 2
    bloom = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    hubb_x = x + tw - icons.text_size(font, "hubb", tracking)[0]
    icons.draw_tracked(bloom, font, "hubb", (hubb_x, y), tracking, LIME, False)
    bloom = bloom.filter(ImageFilter.GaussianBlur(radius=22))
    bloom.putalpha(bloom.getchannel("A").point(lambda a: int(a * 0.28)))
    canvas.alpha_composite(bloom)
    icons.draw_tracked(canvas, font, "proxyhubb", (x, y), tracking, WHITE, True)
    tag = load(FONT_MED, 44)
    draw_tag(canvas, "HTTP CONNECT for a purchase you already paid for", tag, y + (bot - top) + 36)
    sub = load(FONT_MED, 36)
    draw_tag(canvas, "HMAC  ·  proxy.proxyhubb.com:8090  ·  not a VPN", sub, y + (bot - top) + 96)
    return canvas.resize((1400, 560), Image.Resampling.LANCZOS).convert("RGB")


def flatten_screenshot() -> None:
    src = STORE / "screenshot-1280x800.png"
    im = Image.open(src).convert("RGB")
    if im.size != (1280, 800):
        raise SystemExit(f"screenshot must be 1280x800, got {im.size}")
    im.save(src, "PNG", optimize=True)
    print(f"wrote {src} {im.size} RGB")


def main() -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    flatten_screenshot()
    small = render_small()
    marquee = render_marquee()
    small_path = STORE / "promo-440x280.png"
    marquee_path = STORE / "promo-1400x560.png"
    small.save(small_path, "PNG", optimize=True)
    marquee.save(marquee_path, "PNG", optimize=True)
    print(f"wrote {small_path} {small.size} {small.mode}")
    print(f"wrote {marquee_path} {marquee.size} {marquee.mode}")


if __name__ == "__main__":
    main()
