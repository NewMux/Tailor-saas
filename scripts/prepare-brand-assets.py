from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / "client/public/brand/al-hussam-logo.jpg"
output_dir = source.parent

with Image.open(source) as image:
    image = image.convert("RGB")
    for size in (192, 512):
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(output_dir / f"al-hussam-logo-{size}.jpg", quality=92, optimize=True)
