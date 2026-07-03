#!/usr/bin/env python3
"""Generate favicon set (from gum-tree mark) + 1200x630 og-image for stillandgolden.com.au."""

import subprocess, pathlib, base64
from PIL import Image

ROOT = pathlib.Path("/Users/deep/StillandGolden")
MARK = ROOT / "brand/logo-exports/mark-gold.png"
WARM_BLACK = (26, 23, 20)

# --- favicons: gold mark centred on warm-black square ---
mark = Image.open(MARK).convert("RGBA")
canvas = Image.new("RGBA", (512, 512), WARM_BLACK + (255,))
m = mark.copy()
m.thumbnail((320, 400), Image.LANCZOS)
canvas.paste(m, ((512 - m.width) // 2, (512 - m.height) // 2), m)

for size, name in [(32, "favicon-32.png"), (192, "favicon-192.png"), (180, "apple-touch-icon.png")]:
    canvas.resize((size, size), Image.LANCZOS).convert("RGB").save(ROOT / name)
    print(name)
canvas.resize((32, 32), Image.LANCZOS).convert("RGB").save(ROOT / "favicon.ico")
print("favicon.ico")

# --- og-image: hero photo + brand overlay via Chrome headless ---
photo = ROOT / "New photos/Homepage/DSC00127.jpg"
b64 = base64.b64encode(photo.read_bytes()).decode()

html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ width:1200px; height:630px; overflow:hidden; position:relative; font-family:'EB Garamond',serif; background:#1A1714; }}
.photo {{ position:absolute; inset:0; background:url('data:image/jpeg;base64,{b64}') center 35% / cover no-repeat; filter:brightness(0.75); }}
.overlay {{ position:absolute; inset:0; background:linear-gradient(to right, rgba(26,23,20,0.88) 0%, rgba(26,23,20,0.55) 45%, transparent 75%); }}
.content {{ position:absolute; left:80px; top:50%; transform:translateY(-50%); }}
.brand {{ font-size:64px; color:#F8F5F1; letter-spacing:0.06em; margin-bottom:14px; }}
.brand em {{ color:#A8845A; font-style:italic; }}
.line {{ width:70px; height:2px; background:#A8845A; margin:26px 0; }}
.tag {{ font-size:30px; color:#F8F5F1; opacity:0.9; font-style:italic; }}
.loc {{ font-size:22px; color:#A8845A; letter-spacing:0.16em; text-transform:uppercase; margin-top:30px; }}
</style></head>
<body>
<div class="photo"></div><div class="overlay"></div>
<div class="content">
  <div class="brand">Still <em>&amp;</em> Golden</div>
  <div class="line"></div>
  <div class="tag">In-home newborn &amp; family photography</div>
  <div class="loc">Frankston &middot; South-East Melbourne</div>
</div>
</body></html>"""

tmp = pathlib.Path("/tmp/og-image.html")
tmp.write_text(html, encoding="utf-8")
png = pathlib.Path("/tmp/og-image.png")
subprocess.run([
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "--headless", "--disable-gpu", "--no-sandbox",
    f"--screenshot={png}", "--window-size=1200,630", f"file://{tmp}",
], capture_output=True)
Image.open(png).convert("RGB").save(ROOT / "og-image.jpg", quality=88)
print("og-image.jpg")
