from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "assets"

LEVELS = {
    "easy": {
        "front": Path(r"C:\Users\natha\Desktop\T shirts\ideas\incl\games\front easy.png"),
        "art_box": (0.00, 0.64, 0.70, 0.99),
        "focus": (0.47, 0.58),
        "max_large": 1200,
    },
    "medium": {
        "front": Path(r"C:\Users\natha\Desktop\T shirts\ideas\incl\games\front medium.png"),
        "art_box": (0.00, 0.58, 0.70, 0.98),
        "focus": (0.50, 0.58),
        "max_large": 2200,
    },
    "hard": {
        "front": Path(r"C:\Users\natha\Desktop\T shirts\ideas\incl\games\front hard.png"),
        "art_box": (0.00, 0.60, 0.70, 0.98),
        "focus": (0.51, 0.55),
        "max_large": 2200,
    },
    "challenge": {
        "front": Path(r"C:\Users\natha\Downloads\challenge front.png"),
        "art_box": (0.00, 0.64, 0.70, 0.98),
        "focus": (0.50, 0.58),
        "max_large": 1600,
    },
}

TACTICS = {
    "teacher-hint": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 9, 2026, 01_18_13 PM (1).png"),
    "definition-help": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 9, 2026, 01_18_13 PM (2).png"),
    "japanese-help": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 9, 2026, 01_18_14 PM (3).png"),
    "example-help": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 9, 2026, 01_18_14 PM (4).png"),
    "reroll": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 9, 2026, 01_18_15 PM (5).png"),
    "extra-time": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 9, 2026, 01_18_15 PM (6).png"),
    "second-chance": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 9, 2026, 01_18_16 PM (7).png"),
    "word-swap": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 9, 2026, 01_18_20 PM (8).png"),
}

MISSIONS = {
    "sentence": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 09_36_34 AM (1).png"),
    "question": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 09_36_34 AM (2).png"),
    "answer": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 09_36_35 AM (3).png"),
    "example": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 09_36_35 AM (4).png"),
    "opinion": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 09_36_35 AM (5).png"),
    "connection": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 09_36_35 AM (6).png"),
    "story": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 09_36_35 AM (7).png"),
    "combo": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 09_36_35 AM (8).png"),
}

COVERS = {
    "mission-deck": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 10_19_38 AM (1).png"),
    "tactic-deck": Path(r"C:\Users\natha\Downloads\Images and Graphics\ChatGPT Images\ChatGPT Image Jul 10, 2026, 10_19_38 AM (2).png"),
}


def open_rgb(path: Path) -> Image.Image:
    if not path.exists():
        raise FileNotFoundError(path)
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def relative_crop(image: Image.Image, box: tuple[float, float, float, float]) -> Image.Image:
    w, h = image.size
    return image.crop((round(box[0] * w), round(box[1] * h), round(box[2] * w), round(box[3] * h)))


def cover(image: Image.Image, size: tuple[int, int], focus: tuple[float, float] = (0.5, 0.5)) -> Image.Image:
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=focus)


def save_webp(image: Image.Image, path: Path, quality: int = 84) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=quality, method=6, optimize=True)


def build_levels() -> None:
    for slug, config in LEVELS.items():
        source = open_rgb(config["front"])
        art = relative_crop(source, config["art_box"])
        max_large = int(config["max_large"])
        large_h = round(max_large * 0.56)
        medium_w = min(1400, max_large)
        medium_h = round(medium_w * 0.62)
        mobile_w = min(900, max_large)
        mobile_h = round(mobile_w * 1.22)
        thumb_w = min(640, max_large)
        focus = config["focus"]
        level_dir = OUT / "art" / slug
        save_webp(cover(art, (max_large, large_h), focus), level_dir / "landscape-large.webp", 86)
        save_webp(cover(art, (medium_w, medium_h), focus), level_dir / "landscape-medium.webp", 85)
        save_webp(cover(art, (mobile_w, mobile_h), focus), level_dir / "landscape-mobile.webp", 84)
        save_webp(cover(art, (thumb_w, round(thumb_w * 0.64)), focus), level_dir / "deck-thumbnail.webp", 84)


def build_decor() -> None:
    source = open_rgb(LEVELS["medium"]["front"])
    emblem = relative_crop(source, (0.64, 0.66, 0.90, 0.91))
    plaque = relative_crop(source, (0.90, 0.63, 0.985, 0.92))
    seal = relative_crop(source, (0.925, 0.825, 0.975, 0.91))
    paper = relative_crop(source, (0.43, 0.03, 0.78, 0.24))
    paper = ImageEnhance.Contrast(paper).enhance(0.82)
    decor = OUT / "decor"
    save_webp(cover(emblem, (620, 330), (0.5, 0.5)), decor / "eiken-word-deck-emblem.webp", 88)
    save_webp(cover(plaque, (210, 560), (0.5, 0.5)), decor / "eiken-plaque.webp", 88)
    save_webp(cover(seal, (180, 180), (0.5, 0.5)), decor / "nathan-seal.webp", 90)
    save_webp(cover(paper, (1400, 900), (0.5, 0.5)), decor / "paper-texture.webp", 72)


def build_card_art() -> None:
    tactic_dir = OUT / "cards" / "tactics"
    for slug, path in TACTICS.items():
        source = open_rgb(path)
        illustration = relative_crop(source, (0.055, 0.245, 0.945, 0.72))
        save_webp(cover(illustration, (620, 360), (0.5, 0.46)), tactic_dir / f"{slug}.webp", 82)

    mission_dir = OUT / "cards" / "missions"
    for slug, path in MISSIONS.items():
        source = open_rgb(path)
        illustration = relative_crop(source, (0.055, 0.20, 0.945, 0.73))
        save_webp(cover(illustration, (720, 390), (0.5, 0.47)), mission_dir / f"{slug}.webp", 82)

    cover_dir = OUT / "cards" / "covers"
    for slug, path in COVERS.items():
        source = open_rgb(path)
        width = 480
        height = round(width * source.height / source.width)
        save_webp(source.resize((width, height), Image.Resampling.LANCZOS), cover_dir / f"{slug}.webp", 84)


def main() -> None:
    build_levels()
    build_decor()
    build_card_art()
    files = sorted(OUT.rglob("*.webp"))
    total = sum(path.stat().st_size for path in files)
    print(f"Created {len(files)} optimized WebP assets ({total / 1024 / 1024:.2f} MB) in {OUT}")


if __name__ == "__main__":
    main()
