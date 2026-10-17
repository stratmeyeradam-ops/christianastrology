"""Print-resolution artwork for the Printify store (KJV verses are public domain).

    python3 scripts/print-art.py        → writes PNGs to private/print-art/

Each file is sized to its Printify print area, so nothing is upscaled when printed.
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "private", "print-art")
URW = "/usr/share/fonts/opentype/urw-base35/"
SERIF_BOLD = URW + "P052-Bold.otf"
SERIF = URW + "P052-Roman.otf"
SERIF_ITALIC = URW + "P052-Italic.otf"
GLYPHS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

NAVY = (11, 26, 51)
NAVY_DEEP = (6, 14, 30)
GOLD = (197, 155, 72)
GOLD_LIGHT = (230, 199, 126)
CREAM = (250, 246, 238)


def font(path, size):
    return ImageFont.truetype(path, size)


def spaced(draw, center_x, y, text, fnt, fill, tracking=0.12):
    """Letter-spaced line centred on center_x; returns its height."""
    gap = fnt.size * tracking
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + gap * (len(text) - 1)
    x = center_x - total / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += w + gap
    box = fnt.getbbox(text)
    return box[3] - box[1]


def centered(draw, center_x, y, text, fnt, fill):
    w = draw.textlength(text, font=fnt)
    draw.text((center_x - w / 2, y), text, font=fnt, fill=fill)
    box = fnt.getbbox(text)
    return box[3] - box[1]


def wrap(draw, text, fnt, max_w):
    lines, line = [], ""
    for word in text.split():
        test = f"{line} {word}".strip()
        if draw.textlength(test, font=fnt) <= max_w:
            line = test
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def star(layer, x, y, r, color, glow=True):
    """A soft glowing star: blurred halo plus a sharp four-point sparkle."""
    if glow:
        halo = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        ImageDraw.Draw(halo).ellipse((x - r * 3, y - r * 3, x + r * 3, y + r * 3), fill=color + (110,))
        layer.alpha_composite(halo.filter(ImageFilter.GaussianBlur(r * 1.6)))
    d = ImageDraw.Draw(layer)
    d.ellipse((x - r, y - r, x + r, y + r), fill=color + (255,))
    long, thin = r * 4.2, max(1, r * 0.28)
    d.polygon([(x, y - long), (x + thin, y), (x, y + long), (x - thin, y)], fill=color + (255,))
    d.polygon([(x - long, y), (x, y - thin), (x + long, y), (x, y + thin)], fill=color + (255,))


def star_field(layer, box, count, seed, color=CREAM, rmax=3.0):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = box
    for _ in range(count):
        x, y = rnd.uniform(x0, x1), rnd.uniform(y0, y1)
        r = rnd.random() ** 3 * rmax + 0.6
        a = int(90 + rnd.random() * 165)
        d.ellipse((x - r, y - r, x + r, y + r), fill=color + (a,))


def navy_background(w, h):
    bg = Image.new("RGBA", (w, h), NAVY_DEEP + (255,))
    grad = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(grad).ellipse((-w * 0.2, -h * 0.1, w * 1.2, h * 0.9), fill=NAVY + (255,))
    bg.alpha_composite(grad.filter(ImageFilter.GaussianBlur(min(w, h) * 0.18)))
    return bg


def save(img, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    img.save(path, optimize=True)
    print(f"{name}: {img.size[0]}x{img.size[1]}")


# --- Tee: "He Counts the Stars", gold on navy fabric (transparent background) --------------------
def tee():
    w, h = 3319, 3761
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cx = w / 2
    rnd = random.Random(147)
    # An arc of stars over the title.
    for i in range(23):
        t = i / 22
        x = w * 0.12 + t * w * 0.76
        y = h * 0.30 - math.sin(t * math.pi) * h * 0.17 + rnd.uniform(-60, 60)
        star(img, x, y, rnd.choice([7, 9, 12, 16, 22]), GOLD_LIGHT if i % 4 else CREAM)
    d = ImageDraw.Draw(img)
    y = h * 0.37
    y += spaced(d, cx, y, "HE COUNTS", font(SERIF_BOLD, 330), GOLD) + 90
    y += spaced(d, cx, y, "THE STARS", font(SERIF_BOLD, 330), GOLD) + 150
    for line in wrap(d, "He telleth the number of the stars; he calleth them all by their names.", font(SERIF_ITALIC, 150), w * 0.8):
        y += centered(d, cx, y, line, font(SERIF_ITALIC, 150), CREAM) + 60
    y += 70
    spaced(d, cx, y, "PSALM 147:4", font(SERIF, 120), GOLD_LIGHT, 0.3)
    save(img, "tee-he-counts-the-stars.png")


# --- Hoodie: the Pleiades, Job 38:31 (transparent background) -----------------------------------
def hoodie():
    w, h = 3709, 2472
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    # Real relative positions of the Seven Sisters (RA/Dec offsets around Alcyone), drawn mirrored as seen in the sky.
    sisters = {"Atlas": (-0.86, 0.06, 15), "Pleione": (-0.84, -0.2, 9), "Alcyone": (0, 0, 20), "Merope": (0.32, 0.55, 13),
               "Maia": (0.62, -0.32, 13), "Electra": (0.98, 0.18, 14), "Taygeta": (0.74, -0.74, 11), "Celaeno": (1.02, -0.6, 8)}
    cx, cy, scale = w * 0.5, h * 0.3, w * 0.17
    pts = {n: (cx - x * scale, cy - y * scale, r) for n, (x, y, r) in sisters.items()}
    d = ImageDraw.Draw(img)
    for a, b in [("Atlas", "Alcyone"), ("Alcyone", "Merope"), ("Alcyone", "Maia"), ("Maia", "Taygeta"), ("Maia", "Electra"), ("Merope", "Electra"), ("Atlas", "Pleione")]:
        d.line((pts[a][:2], pts[b][:2]), fill=GOLD + (150,), width=5)
    for x, y, r in pts.values():
        star(img, x, y, r * 1.5, CREAM)
    d = ImageDraw.Draw(img)
    y = h * 0.6
    y += spaced(d, w / 2, y, "CANST THOU BIND THE SWEET", font(SERIF_BOLD, 175), GOLD) + 60
    y += spaced(d, w / 2, y, "INFLUENCES OF PLEIADES?", font(SERIF_BOLD, 175), GOLD) + 90
    spaced(d, w / 2, y, "JOB 38:31", font(SERIF, 115), GOLD_LIGHT, 0.3)
    save(img, "hoodie-pleiades.png")


# --- Mug: full-wrap navy with the verse on both sides -------------------------------------------
def mug():
    w, h = 2475, 1155
    img = navy_background(w, h)
    star_field(img, (0, 0, w, h), 260, 19, rmax=3.2)
    for side in (0.25, 0.75):
        cx = w * side
        star(img, cx, h * 0.17, 13, GOLD_LIGHT)
        d = ImageDraw.Draw(img)
        y = h * 0.29
        y += spaced(d, cx, y, "THE HEAVENS", font(SERIF_BOLD, 118), GOLD) + 40
        y += spaced(d, cx, y, "DECLARE", font(SERIF_BOLD, 118), GOLD) + 55
        for line in ["the glory of God; and the", "firmament sheweth his handywork."]:
            y += centered(d, cx, y, line, font(SERIF_ITALIC, 52), CREAM) + 22
        y += 30
        spaced(d, cx, y, "PSALM 19:1", font(SERIF, 46), GOLD_LIGHT, 0.3)
    save(img.convert("RGB"), "mug-heavens-declare.png")


# --- Poster: the twelve signs of the Mazzaroth around the verse (2:3, full bleed) ---------------
def poster():
    w, h = 4800, 7200  # 24x36 at 200 dpi; same 2:3 shape as 12x18 and 16x24
    img = navy_background(w, h)
    star_field(img, (0, 0, w, h), 2600, 1914, rmax=4.5)
    cx, cy, R = w / 2, h * 0.47, w * 0.36
    d = ImageDraw.Draw(img)
    for r, width, alpha in [(R * 1.08, 6, 200), (R * 0.82, 3, 140)]:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=GOLD + (alpha,), width=width)
    names = ["ARIES", "TAURUS", "GEMINI", "CANCER", "LEO", "VIRGO", "LIBRA", "SCORPIO", "SAGITTARIUS", "CAPRICORN", "AQUARIUS", "PISCES"]
    glyph_font, name_font = font(GLYPHS, 210), font(SERIF, 78)
    for i, (glyph, name) in enumerate(zip("♈♉♊♋♌♍♎♏♐♑♒♓", names)):
        ang = -math.pi / 2 + i * math.tau / 12
        gx, gy = cx + math.cos(ang) * R * 0.95, cy + math.sin(ang) * R * 0.95
        gw = d.textlength(glyph, font=glyph_font)
        d.text((gx - gw / 2, gy - 130), glyph, font=glyph_font, fill=GOLD_LIGHT)
        spaced(d, gx, gy + 110, name, name_font, CREAM, 0.15)
        tx, ty = cx + math.cos(ang + math.tau / 24) * R * 1.08, cy + math.sin(ang + math.tau / 24) * R * 1.08
        d.ellipse((tx - 14, ty - 14, tx + 14, ty + 14), fill=GOLD + (255,))
    # A simple cross at the centre.
    arm, thick = R * 0.34, R * 0.045
    d.rectangle((cx - thick, cy - arm, cx + thick, cy + arm * 1.25), fill=GOLD + (255,))
    d.rectangle((cx - arm * 0.68, cy - arm * 0.45 - thick, cx + arm * 0.68, cy - arm * 0.45 + thick), fill=GOLD + (255,))
    star(img, cx, cy - arm * 1.32, 22, CREAM)
    d = ImageDraw.Draw(img)
    y = h * 0.055
    y += spaced(d, cx, y, "THE HEAVENS", font(SERIF_BOLD, 330), GOLD) + 110
    spaced(d, cx, y, "DECLARE", font(SERIF_BOLD, 330), GOLD)
    y = h * 0.82
    for line in ["The heavens declare the glory of God;", "and the firmament sheweth his handywork."]:
        y += centered(d, cx, y, line, font(SERIF_ITALIC, 150), CREAM) + 70
    y += 70
    spaced(d, cx, y, "PSALM 19:1", font(SERIF, 120), GOLD_LIGHT, 0.3)
    save(img.convert("RGB"), "poster-heavens-declare.png")


# --- Tote: navy ink on natural canvas (transparent background) ----------------------------------
def tote():
    w, h = 3000, 2700
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cx = w / 2
    star(img, cx, h * 0.17, 30, NAVY, glow=False)
    rnd = random.Random(114)
    for i in range(9):
        t = i / 8
        star(img, w * 0.2 + t * w * 0.6, h * 0.27 + rnd.uniform(-40, 40), rnd.choice([7, 9, 11]), NAVY, glow=False)
    d = ImageDraw.Draw(img)
    y = h * 0.36
    y += spaced(d, cx, y, "GUIDING FAITH", font(SERIF_BOLD, 250), NAVY) + 70
    y += spaced(d, cx, y, "ALIGNING STARS", font(SERIF_BOLD, 250), NAVY) + 130
    for line in ["Let them be for signs, and for seasons,", "and for days, and years."]:
        y += centered(d, cx, y, line, font(SERIF_ITALIC, 120), NAVY) + 50
    y += 60
    spaced(d, cx, y, "GENESIS 1:14", font(SERIF, 100), NAVY, 0.3)
    save(img, "tote-guiding-faith.png")


# --- Journal: full cover wrap, title on the front (right) half ----------------------------------
def journal():
    w, h = 4065, 2850
    img = navy_background(w, h)
    star_field(img, (0, 0, w, h), 900, 521, rmax=4)
    cx = w * 0.75
    d = ImageDraw.Draw(img)
    # Ring kept well inside the trim (front cover is the right half; ~150 px safe margin).
    for r, alpha in [(h * 0.3, 170), (h * 0.275, 110)]:
        d.ellipse((cx - r, h * 0.4 - r, cx + r, h * 0.4 + r), outline=GOLD + (alpha,), width=5)
    star(img, cx, h * 0.25, 26, GOLD_LIGHT)
    d = ImageDraw.Draw(img)
    y = h * 0.33
    y += spaced(d, cx, y, "DISCERNMENT", font(SERIF_BOLD, 128), GOLD) + 50
    spaced(d, cx, y, "JOURNAL", font(SERIF_BOLD, 128), GOLD)
    y = h * 0.77
    for line in ["Prove all things;", "hold fast that which is good."]:
        y += centered(d, cx, y, line, font(SERIF_ITALIC, 82), CREAM) + 32
    y += 35
    spaced(d, cx, y, "1 THESSALONIANS 5:21", font(SERIF, 60), GOLD_LIGHT, 0.3)
    star(img, w * 0.25, h * 0.86, 10, GOLD_LIGHT)
    d = ImageDraw.Draw(img)
    spaced(d, w * 0.25, h * 0.9, "CHRISTIANASTROLOGY.ORG", font(SERIF, 52), GOLD_LIGHT, 0.3)
    save(img.convert("RGB"), "journal-discernment.png")


if __name__ == "__main__":
    for make in (tee, hoodie, mug, poster, tote, journal):
        make()
