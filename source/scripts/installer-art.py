# Draws the installer artwork: python scripts/installer-art.py build  (needs Pillow and the Inter font).
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, sys, os
out = sys.argv[1]
F = '/usr/share/fonts/opentype/inter/'
font = lambda n, s: ImageFont.truetype(F + n, s)
icon = Image.open(os.path.join(out, 'icon.png')).convert('RGBA')
S = 3

def aurora(w, h, blobs):
    base = Image.new('RGB', (w, h), (11, 10, 18))
    for cx, cy, r, col in blobs:
        g = Image.new('L', (w, h), 0)
        ImageDraw.Draw(g).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
        g = g.filter(ImageFilter.GaussianBlur(r * 0.55))
        base = Image.composite(Image.blend(base, Image.new('RGB', (w, h), col), 0.85), base, g)
    return base

def sidebar(name, title, sub):
    w, h = 164 * S, 314 * S
    im = aurora(w, h, [(int(w * .15), int(h * .18), int(w * .75), (255, 79, 139)), (int(w * .95), int(h * .45), int(w * .7), (176, 60, 255)),
                       (int(w * .2), int(h * .9), int(w * .8), (74, 92, 255)), (int(w * .9), int(h * .95), int(w * .5), (42, 209, 201))]).convert('RGBA')
    veil = Image.new('RGBA', (w, h)); vd = ImageDraw.Draw(veil)
    for y in range(h):
        vd.line([(0, y), (w, y)], fill=(8, 7, 14, int(70 + 90 * max(0, (y / h - .45)) / .55)))
    im = Image.alpha_composite(im, veil)
    d = ImageDraw.Draw(im)
    n, step, bw = 9, 13 * S, 7 * S
    bx = (w - ((n - 1) * step + bw)) // 2
    by = int(h * .62)
    for i in range(n):
        bh = int((.25 + .75 * abs(math.sin(i * 1.3 + .6))) * 34 * S)
        x = bx + i * step
        d.rounded_rectangle((x, by - bh, x + bw, by), radius=int(3.5 * S), fill=(255, 255, 255, 150 + 10 * i))
    isz = 64 * S; ic = icon.resize((isz, isz), Image.LANCZOS)
    ix, iy = (w - isz) // 2, 38 * S
    glow = Image.new('RGBA', (w, h)); ImageDraw.Draw(glow).ellipse((ix - 10 * S, iy - 10 * S, ix + isz + 10 * S, iy + isz + 10 * S), fill=(255, 90, 160, 140))
    im = Image.alpha_composite(im, glow.filter(ImageFilter.GaussianBlur(14 * S)))
    im.alpha_composite(ic, (ix, iy))
    d = ImageDraw.Draw(im)
    f1, f2 = font('InterDisplay-ExtraBold.otf', 22 * S), font('Inter-Medium.otf', int(10.5 * S))
    d.text(((w - d.textlength(title, font=f1)) / 2, iy + isz + 14 * S), title, font=f1, fill='white')
    y = int(h * .74)
    for line in sub:
        d.text(((w - d.textlength(line, font=f2)) / 2, y), line, font=f2, fill=(235, 235, 245, 215)); y += 15 * S
    im.convert('RGB').resize((164, 314), Image.LANCZOS).save(os.path.join(out, name))

sidebar('installerSidebar.bmp', 'Pulse Music', ['Your Spotify, with lyrics,', 'an AI DJ and friends.'])
sidebar('uninstallerSidebar.bmp', 'Pulse Music', ['Thanks for listening.', 'See you soon.'])

w, h = 150 * S, 57 * S
im = aurora(w, h, [(int(w * .1), int(h * .2), int(h * 1.2), (255, 79, 139)), (int(w * .6), int(h * .9), int(h * 1.3), (176, 60, 255)), (w, int(h * .1), int(h * 1.1), (74, 92, 255))]).convert('RGBA')
im = Image.alpha_composite(im, Image.new('RGBA', (w, h), (8, 7, 14, 90)))
isz = 34 * S; im.alpha_composite(icon.resize((isz, isz), Image.LANCZOS), (10 * S, (h - isz) // 2))
ImageDraw.Draw(im).text((52 * S, (h - 17 * S) // 2 - 3 * S), 'Pulse', font=font('InterDisplay-ExtraBold.otf', 17 * S), fill='white')
im.convert('RGB').resize((150, 57), Image.LANCZOS).save(os.path.join(out, 'installerHeader.bmp'))
