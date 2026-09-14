from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageOps


ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build optimized EIKEN visual assets from a source manifest.")
    parser.add_argument("--manifest", type=Path, required=True, help="JSON manifest describing clean source images and crops.")
    parser.add_argument("--source-dir", type=Path, help="Optional base directory for relative source paths.")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist" / "assets")
    return parser.parse_args()


def resolve_source(value: str, manifest: Path, source_dir: Path | None) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return (source_dir or manifest.parent) / path


def open_rgb(path: Path) -> Image.Image:
    if not path.exists():
        raise FileNotFoundError(path)
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def relative_crop(image: Image.Image, box: list[float] | tuple[float, float, float, float]) -> Image.Image:
    width, height = image.size
    return image.crop(tuple(round(value * size) for value, size in zip(box, (width, height, width, height))))


def cover(image: Image.Image, size: tuple[int, int], focus: tuple[float, float] = (0.5, 0.5)) -> Image.Image:
    return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=focus)


def contain(image: Image.Image, size: tuple[int, int], color: tuple[int, int, int] = (246, 229, 194)) -> Image.Image:
    fitted = ImageOps.contain(image, size, method=Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", size, color)
    canvas.paste(fitted, ((size[0] - fitted.width) // 2, (size[1] - fitted.height) // 2))
    return canvas


def save_webp(image: Image.Image, path: Path, quality: int = 84) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=quality, method=6, optimize=True)


def build_levels(config: dict[str, Any], manifest: Path, source_dir: Path | None, output: Path) -> None:
    for slug, item in config.items():
        source = open_rgb(resolve_source(item["front"], manifest, source_dir))
        art = relative_crop(source, item["art_box"])
        thumbnail_art = relative_crop(source, item.get("thumbnail_box", item["art_box"]))
        focus = tuple(item.get("focus", (0.5, 0.65)))
        max_width = min(int(item.get("max_large", 1800)), source.width)
        sizes = {
            "landscape-large.webp": (max_width, round(max_width * 0.45)),
            "landscape-medium.webp": (min(1200, max_width), round(min(1200, max_width) * 0.50)),
            "landscape-mobile.webp": (min(760, max_width), round(min(760, max_width) * 0.72)),
        }
        level_dir = output / "art" / slug
        for filename, size in sizes.items():
            save_webp(cover(art, size, focus), level_dir / filename, 85)
        thumb_width = min(640, source.width)
        save_webp(cover(thumbnail_art, (thumb_width, round(thumb_width * 0.64)), focus), level_dir / "deck-thumbnail.webp", 84)


def build_decor(config: dict[str, Any], manifest: Path, source_dir: Path | None, output: Path) -> None:
    source = open_rgb(resolve_source(config["source"], manifest, source_dir))
    decor = output / "decor"
    emblem = relative_crop(source, config["emblem_box"])
    plaque = relative_crop(source, config["plaque_box"])
    seal = relative_crop(source, config["seal_box"])
    paper = ImageEnhance.Contrast(relative_crop(source, config["paper_box"])).enhance(0.82)
    save_webp(contain(emblem, (620, 330)), decor / "eiken-word-deck-emblem.webp", 88)
    save_webp(contain(plaque, (230, 620)), decor / "eiken-plaque.webp", 88)
    save_webp(contain(seal, (180, 220)), decor / "nathan-seal.webp", 90)
    save_webp(cover(paper, (1400, 900)), decor / "paper-texture.webp", 72)


def build_cards(group: str, config: dict[str, Any], manifest: Path, source_dir: Path | None, output: Path) -> None:
    group_dir = output / "cards" / group
    for slug, item in config.items():
        source = open_rgb(resolve_source(item["source"], manifest, source_dir))
        crop = relative_crop(source, item.get("crop", [0.055, 0.20, 0.945, 0.73]))
        size = tuple(item.get("size", [720, 390]))
        save_webp(cover(crop, size, tuple(item.get("focus", [0.5, 0.47]))), group_dir / f"{slug}.webp", 82)


def build_covers(config: dict[str, Any], manifest: Path, source_dir: Path | None, output: Path) -> None:
    cover_dir = output / "cards" / "covers"
    for slug, value in config.items():
        source = open_rgb(resolve_source(value, manifest, source_dir))
        width = min(480, source.width)
        save_webp(source.resize((width, round(width * source.height / source.width)), Image.Resampling.LANCZOS), cover_dir / f"{slug}.webp", 84)


def main() -> None:
    args = parse_args()
    manifest_path = args.manifest.resolve()
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    build_levels(data["levels"], manifest_path, args.source_dir, args.output_dir)
    build_decor(data["decor"], manifest_path, args.source_dir, args.output_dir)
    build_cards("tactics", data.get("tactics", {}), manifest_path, args.source_dir, args.output_dir)
    build_cards("missions", data.get("missions", {}), manifest_path, args.source_dir, args.output_dir)
    build_covers(data.get("covers", {}), manifest_path, args.source_dir, args.output_dir)
    files = sorted(args.output_dir.rglob("*.webp"))
    total = sum(path.stat().st_size for path in files)
    print(f"Created {len(files)} optimized WebP assets ({total / 1024 / 1024:.2f} MB) in {args.output_dir}")


if __name__ == "__main__":
    main()
