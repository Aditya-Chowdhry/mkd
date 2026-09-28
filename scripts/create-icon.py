"""Regenerate the app icons with Pillow (optional development tool)."""
from pathlib import Path
from PIL import Image, ImageDraw

destination = Path(__file__).resolve().parent.parent / 'assets'
destination.mkdir(exist_ok=True)
image = Image.new('RGBA', (1024, 1024))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((72, 72, 952, 952), radius=204, fill='#71618f')
# Draw a crisp, font-independent lowercase m and downward Markdown arrow.
ink = '#fcfbf8'
draw.line([(256, 671), (256, 387)], fill=ink, width=58)
draw.arc((249, 343, 453, 545), 180, 360, fill=ink, width=56)
draw.line([(425, 441), (425, 671)], fill=ink, width=56)
draw.arc((421, 343, 625, 545), 180, 360, fill=ink, width=56)
draw.line([(597, 441), (597, 671)], fill=ink, width=56)
draw.line([(744, 371), (744, 628)], fill=ink, width=50)
draw.polygon([(660, 576), (828, 576), (744, 693)], fill=ink)
image.save(destination / 'icon.png')
image.save(destination / 'icon.icns')
image.save(destination / 'icon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
