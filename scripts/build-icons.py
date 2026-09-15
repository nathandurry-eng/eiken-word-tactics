"""Generate PNG install icons matching the checked-in SVG mark."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "icons"
FONT_CANDIDATES = [
    Path("C:/Windows/Fonts/YuGothB.ttc"),
    Path("C:/Windows/Fonts/msgothic.ttc"),
    Path("C:/Windows/Fonts/meiryo.ttc"),
]


def font(size: int):
    for candidate in FONT_CANDIDATES:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size, index=0)
    return ImageFont.load_default(size=size)


def build(size: int, maskable: bool = False):
    scale = size / 512
    image = Image.new("RGB", (size, size), "#173f38")
    draw = ImageDraw.Draw(image)
    if maskable:
        inset, radius = 74, 182
        draw.ellipse(tuple(int(value * scale) for value in (inset, inset, 512 - inset, 512 - inset)), fill="#f3e6c8", outline="#b68c42", width=max(2, int(18 * scale)))
    else:
        inset, radius = 42, 52
        draw.rounded_rectangle(tuple(int(value * scale) for value in (inset, inset, 512 - inset, 512 - inset)), radius=int(radius * scale), fill="#f3e6c8", outline="#b68c42", width=max(2, int(18 * scale)))
        wave_y = int(397 * scale)
        draw.rectangle((int(60 * scale), wave_y, int(452 * scale), int(470 * scale)), fill="#315b79")
        for x in range(int(75 * scale), int(430 * scale), max(1, int(95 * scale))):
            draw.arc((x, int(382 * scale), x + int(90 * scale), int(446 * scale)), 190, 350, fill="#b68c42", width=max(2, int(5 * scale)))
    label = "英"
    label_font = font(max(20, int((220 if maskable else 238) * scale)))
    bbox = draw.textbbox((0, 0), label, font=label_font)
    x = (size - (bbox[2] - bbox[0])) / 2
    y = int((115 if maskable else 92) * scale) - bbox[1]
    draw.text((x, y), label, font=label_font, fill="#24211e")
    return image


OUT.mkdir(parents=True, exist_ok=True)
build(192).save(OUT / "icon-192.png", optimize=True)
build(512).save(OUT / "icon-512.png", optimize=True)
build(512, maskable=True).save(OUT / "maskable-512.png", optimize=True)
print("Generated 192px and 512px PNG install icons.")
