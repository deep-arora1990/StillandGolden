# Still & Golden — Development Documentation

## Overview

Still & Golden Photography is a single-page static website for Deep Arora's newborn and family photography business based in SE Melbourne, Australia.

- **Live site:** https://stillandgolden.com.au
- **GitHub:** https://github.com/deep-arora1990/StillandGolden
- **Hosting:** Netlify (auto-deploys from `main` branch)
- **Stack:** Vanilla HTML, CSS, JavaScript — no frameworks, no build step

---

## Project Structure

```
StillandGolden/
├── index.html                  # Main website (single page)
├── netlify.toml                # Netlify config: headers, redirects
├── brand-voice-guide.md        # Tone of voice & style guide
├── DEVELOPMENT.md              # This file
│
├── Images/                     # Original images (JPEG/HEIC source files)
│   └── webp/                   # Optimised WebP versions (served to browsers)
│
├── card-front-print.html       # Business card front — print-ready (100×65mm)
├── card-back-print.html        # Business card back — print-ready (100×65mm)
├── card-front-export.html      # Business card front — JPG screenshot export (340×207px)
├── card-back-export.html       # Business card back — JPG screenshot export
│
├── flyer-dl-print.html         # DL flyer — print-ready (109×220mm, 300dpi)
├── flyer-a5-print.html         # A5 flyer — print-ready
│
└── qr-dl-clean.svg             # QR code for https://stillandgolden.com.au/#contact
```

---

## Website Sections (index.html)

| Section | ID / Anchor | Description |
|---------|------------|-------------|
| Nav | `#nav` | Fixed top nav, scrolled state, mobile hamburger menu |
| Hero | `#hero` | Full-screen intro with scroll CTA |
| Portfolio grid | `#grid` | 3-column CSS masonry of all portfolio images |
| Sessions & Pricing | `#sessions` | Newborn, Family, Combo pricing |
| Process | — | 4-step how-it-works |
| Testimonials | — | 3-column testimonial grid |
| About / Photographer | `#about` | Deep's profile photo + bio |
| Contact & Enquiry Form | `#contact` | Contact details + Netlify form |
| Footer | — | Logo, ABN, service area |

---

## Brand

### Colours (CSS variables)
```css
--off-white:  #F8F5F1
--warm-black: #1A1714
--gold:       #A8845A
--mid:        #8A7E78
```

### Fonts
- **Serif:** EB Garamond (Google Fonts) — headings, logo, names
- **Sans:** DM Sans (Google Fonts) — body, labels, UI

### Business Details
- **Owner:** Deep Arora
- **Phone:** 0426 834 359
- **Email:** hello@stillandgolden.com.au
- **Instagram:** @stillandgoldenphotography
- **ABN:** 37 280 912 036
- **Area:** Frankston · Chelsea · Seaford · Langwarrin · Mt Eliza · Mornington Peninsula

---

## Images

### Adding new images
1. Add the source file (JPEG or HEIC) to `Images/`
2. Convert HEIC to JPEG if needed:
   ```bash
   sips -s format jpeg Images/FILENAME.heic --out Images/FILENAME.jpg
   ```
3. Generate WebP version (max 1200px wide, quality 82):
   ```bash
   cwebp -q 82 -resize 1200 0 Images/FILENAME.jpg -o Images/webp/FILENAME.webp
   ```
4. Add to the portfolio grid in `index.html` using the `<picture>` pattern:
   ```html
   <div class="masonry-item reveal d1">
     <picture>
       <source srcset="Images/webp/FILENAME.webp" type="image/webp">
       <img src="Images/FILENAME.jpg" alt="Photography session" loading="lazy">
     </picture>
   </div>
   ```
   - Use `d1`, `d2`, or `d3` class to vary the reveal animation delay
   - Omit `loading="lazy"` on the first 2 items (above the fold)

### Removing images
Simply delete the `<div class="masonry-item ...">` block from `index.html`.

### Profile photo
The photographer profile photo is in the `#about` section (currently `DSC03278.jpg`).

---

## Contact Form

The enquiry form uses **Netlify Forms** (`data-netlify="true"`).

- **Form name:** `booking-enquiry`
- **Fields:** first_name, last_name, email, phone, session_type, preferred_date, message
- **Spam protection:** honeypot field (`bot-field`)
- **Email notifications:** configured in Netlify Dashboard → Forms → booking-enquiry → Form notifications

To update the notification email:
1. Go to [app.netlify.com](https://app.netlify.com)
2. Select the Still & Golden site
3. **Forms** → **booking-enquiry** → **Form notifications** → **Email notification**
4. Enter `hello@stillandgolden.com.au`

---

## Deployment

### Normal workflow
```bash
# Make changes to index.html or other files
git add index.html
git commit -m "Description of change"
git push origin main
```
Netlify auto-deploys on every push to `main`. Typically live within 1–2 minutes.

### Verify deployment
Check: https://app.netlify.com → Deploys tab for build status.

### netlify.toml
- **Publish directory:** `.` (root — no build step)
- **Security headers:** X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- **Redirect:** `/index` → `/` (301)

---

## Print Files

All print files are standalone HTML pages designed for PDF export via Chrome headless.

### Generating PDFs

**Standard (screen resolution):**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless --disable-gpu --no-sandbox \
  --print-to-pdf=OUTPUT.pdf \
  --no-margins \
  "file:///Users/deep/StillandGolden/FILENAME.html"
```

**300 DPI (for print submission):**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless --disable-gpu --no-sandbox \
  --print-to-pdf=OUTPUT.pdf \
  --no-margins \
  --force-device-scale-factor=3.125 \
  "file:///Users/deep/StillandGolden/FILENAME.html"
```

> **Important:** Page size is controlled by `@page { size: WIDTHmm HEIGHTmm; margin: 0; }` in the HTML CSS — Chrome ignores `--paper-width`/`--paper-height` CLI flags.

### Officeworks print dimensions (include 5mm bleed)
| Item | File | Dimensions |
|------|------|------------|
| Business card (front) | `card-front-print.html` | 100 × 65mm |
| Business card (back) | `card-back-print.html` | 100 × 65mm |
| DL flyer | `flyer-dl-print.html` | 109 × 220mm |

### Verifying PDF dimensions
```python
import re
data = open('file.pdf', 'rb').read()
m = re.search(rb'/MediaBox\s*\[([^\]]+)\]', data)
pts = list(map(float, m.group(1).split()))
print(f"{pts[2]*0.352778:.1f}mm × {pts[3]*0.352778:.1f}mm")
```

---

## Local Development

No build tools required. Open directly in a browser:
```bash
open -a Safari /Users/deep/StillandGolden/index.html
```

Or use any local server:
```bash
npx serve .
```

---

## Known Behaviours

- **CSS masonry gap:** The `column-count: 3` masonry can leave a small gap at the bottom if the last row of images has uneven heights. This is a CSS columns limitation — reordering images is the best fix.
- **Google Fonts:** The site loads EB Garamond and DM Sans from Google Fonts. Offline previews will fall back to Georgia and system-ui.
- **Scroll reveal:** `.reveal` elements animate in using IntersectionObserver. They won't animate in Safari's local file preview if JS is blocked — works correctly when deployed.
