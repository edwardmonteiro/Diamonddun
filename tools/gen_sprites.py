"""Vector-ish sprites rendered with supersampling + baked glow.

All textures are authored at 2x the in-game display size (game draws them at 0.5).
Run: python3 tools/gen_sprites.py -> public/assets/sprites/*.png
"""
import math
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "sprites")
os.makedirs(OUT, exist_ok=True)
SS = 4  # supersampling


def rgba(h, a=255):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def P(self, pts):
        return [(x * SS, y * SS) for x, y in pts]

    def poly(self, pts, fill, outline=None, width=1):
        self.d.polygon(self.P(pts), fill=fill)
        if outline:
            pp = self.P(pts)
            self.d.line(pp + [pp[0]], fill=outline, width=int(width * SS), joint="curve")

    def line(self, pts, fill, width=1):
        self.d.line(self.P(pts), fill=fill, width=int(width * SS), joint="curve")

    def ellipse(self, box, fill, outline=None, width=1):
        x0, y0, x1, y1 = box
        self.d.ellipse((x0 * SS, y0 * SS, x1 * SS, y1 * SS), fill=fill, outline=outline,
                       width=int(width * SS) if outline else 0)

    def rect(self, box, fill, r=0):
        x0, y0, x1, y1 = box
        self.d.rounded_rectangle((x0 * SS, y0 * SS, x1 * SS, y1 * SS), radius=r * SS, fill=fill)

    def result(self):
        return self.img.resize((self.w, self.h), Image.LANCZOS)


def with_glow(img, color, radius, strength=1.0, passes=2):
    """Composite a coloured blurred halo behind img."""
    a = img.split()[3]
    halo = Image.new("RGBA", img.size, rgba(color, 0))
    glow_a = a.filter(ImageFilter.GaussianBlur(radius))
    arr = np.array(glow_a).astype(np.float32) * strength
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    halo.putalpha(Image.fromarray(arr))
    base = Image.new("RGBA", img.size, (0, 0, 0, 0))
    for _ in range(passes):
        base = Image.alpha_composite(base, halo)
    return Image.alpha_composite(base, img)


def save(img, name):
    img.save(os.path.join(OUT, name + ".png"), optimize=True)
    print("wrote", name, img.size)


# --------------------------------------------------------------- player ---
def player():
    S = 160
    c = Canvas(S, S)
    cx = cy = S / 2
    R = 46
    pts = [(cx + R * math.cos(math.radians(22.5 + 45 * i)), cy + R * math.sin(math.radians(22.5 + 45 * i))) for i in range(8)]
    c.poly(pts, rgba("#7fe9ff"))
    r2 = R * 0.52
    inner = [(cx + r2 * math.cos(math.radians(22.5 + 45 * i)), cy + r2 * math.sin(math.radians(22.5 + 45 * i))) for i in range(8)]
    shades = ["#e9fdff", "#b9f4ff", "#5fd8ff", "#36b4f0", "#2a8fe0", "#3fa9f5", "#8ae6ff", "#d3fbff"]
    for i in range(8):
        c.poly([pts[i], pts[(i + 1) % 8], inner[(i + 1) % 8], inner[i]], rgba(shades[i]))
    c.poly(inner, rgba("#f4feff"))
    # table sparkle
    c.poly([(cx - 8, cy - 6), (cx - 2, cy - 12), (cx + 2, cy - 9), (cx - 4, cy - 3)], rgba("#ffffff"))
    for i in range(8):
        c.line([pts[i], inner[i]], rgba("#ffffff", 120), 1.2)
    c.poly(pts, None, rgba("#ffffff", 230), 2.2)
    save(with_glow(c.result(), "#4fe3ff", 14, 0.9), "player")


# --------------------------------------------------------------- gem ------
def gem(name="gem", top="#c8fbff", mid="#5ee6ff", low="#2794e8", glowc="#5ee6ff"):
    S = 96
    c = Canvas(S, S)
    cx, cy = S / 2, S / 2 - 4
    w, crown, pav = 30, 10, 26
    tl, tr = (cx - w * 0.55, cy - crown), (cx + w * 0.55, cy - crown)
    gl, gr = (cx - w, cy), (cx + w, cy)
    bot = (cx, cy + pav)
    # crown facets
    c.poly([tl, tr, gr, gl], rgba(top))
    c.poly([gl, tl, (cx - w * 0.2, cy)], rgba("#ffffff"))
    c.poly([(cx - w * 0.2, cy), tl, (cx, cy - crown), (cx + w * 0.2, cy)], rgba("#e6feff"))
    c.poly([tr, gr, (cx + w * 0.2, cy)], rgba(mid))
    # pavilion facets
    c.poly([gl, (cx - w * 0.2, cy), bot], rgba(mid))
    c.poly([(cx - w * 0.2, cy), (cx + w * 0.2, cy), bot], rgba("#9ff3ff"))
    c.poly([(cx + w * 0.2, cy), gr, bot], rgba(low))
    c.poly([tl, tr, gr, bot, gl], None, rgba("#ffffff", 235), 1.6)
    c.line([gl, gr], rgba("#ffffff", 200), 1.2)
    save(with_glow(c.result(), glowc, 9, 1.0), name)


# --------------------------------------------------------------- spikes ---
def spikes():
    W_, H_ = 168, 136
    c = Canvas(W_, H_)
    base = H_ - 8
    shards = [(46, 70, 16, -0.1), (84, 104, 20, 0.04), (120, 64, 15, 0.12)]
    for x, h, w, lean in shards:
        tip = (x + lean * h, base - h)
        l, r = (x - w, base), (x + w, base)
        c.poly([l, tip, r], rgba("#5b1a5f"))
        c.poly([l, tip, (x + lean * h * 0.3, base)], rgba("#ff4fb4"))
        c.poly([(x + lean * h * 0.3, base), tip, r], rgba("#b0207a"))
        c.line([l, tip], rgba("#ffd0ef"), 1.6)
    save(with_glow(c.result(), "#ff3fa5", 10, 0.9), "spikes")


# --------------------------------------------------------------- saw ------
def saw():
    S = 260
    c = Canvas(S, S)
    cx = cy = S / 2
    n, R, r = 10, 104, 62
    pts = []
    for i in range(n * 2):
        a = math.pi * i / n
        rad = R if i % 2 == 0 else r
        a2 = a + (0.12 if i % 2 == 0 else 0)
        pts.append((cx + rad * math.cos(a2), cy + rad * math.sin(a2)))
    c.poly(pts, rgba("#ff5a8a"))
    for i in range(0, n * 2, 2):
        c.poly([(cx, cy), pts[i], pts[(i + 1) % (n * 2)]], rgba("#b8185a"))
    c.ellipse((cx - 40, cy - 40, cx + 40, cy + 40), rgba("#2a0b2e"), rgba("#ff9cc0"), 3)
    c.ellipse((cx - 12, cy - 12, cx + 12, cy + 12), rgba("#ffd9e8"))
    c.poly(pts, None, rgba("#ffd1e3", 230), 2)
    save(with_glow(c.result(), "#ff3f7a", 14, 0.85), "saw")


# --------------------------------------------------------------- icicle ---
def stalactite():
    W_, H_ = 100, 240
    c = Canvas(W_, H_)
    cx = W_ / 2
    top = 6
    l, r, tip = (cx - 30, top), (cx + 30, top), (cx + 3, H_ - 14)
    c.poly([l, r, tip], rgba("#3a2f86"))
    c.poly([l, (cx - 4, top), tip], rgba("#a99bff"))
    c.poly([(cx - 4, top), (cx + 12, top), tip], rgba("#7c6cf0"))
    c.line([l, tip, r], rgba("#e6e0ff"), 1.6)
    save(with_glow(c.result(), "#8c7bff", 10, 0.8), "stalactite")


# ----------------------------------------------------------- crystal wall --
def wall():
    W_, H_ = 120, 256
    img = Image.new("RGBA", (W_, H_))
    arr = np.zeros((H_, W_, 4), np.float32)
    x = np.arange(W_)[None, :]
    edge = np.minimum(x, W_ - 1 - x)
    arr[..., 0] = 80
    arr[..., 1] = 220
    arr[..., 2] = 255
    arr[..., 3] = 70 + 120 * np.exp(-edge / 6.0)
    img = Image.fromarray(arr.astype(np.uint8), "RGBA")
    d = ImageDraw.Draw(img)
    # facets (tile seamlessly in y: lines hit top and bottom at same x)
    for (x0, y0, x1, y1) in [(20, 0, 70, 90), (70, 90, 40, 170), (40, 170, 20, 256), (70, 90, 110, 140),
                             (100, 0, 70, 90), (40, 170, 95, 215), (95, 215, 100, 256)]:
        d.line((x0, y0, x1, y1), fill=(220, 252, 255, 150), width=2)
    d.line((3, 0, 3, H_), fill=(230, 255, 255, 230), width=3)
    d.line((W_ - 4, 0, W_ - 4, H_), fill=(230, 255, 255, 230), width=3)
    save(img, "wall")


# ----------------------------------------------------------- platforms ----
def ground():
    W_, H_ = 256, 1024
    y = np.arange(H_)[:, None].astype(np.float32)
    x = np.arange(W_)[None, :].astype(np.float32)
    base = np.array([20, 16, 52], np.float32)
    deep = np.array([8, 6, 22], np.float32)
    t = np.clip(y / 420, 0, 1)
    rgb = base * (1 - t[..., None]) + deep * t[..., None]
    rgb = np.broadcast_to(rgb, (H_, W_, 3)).copy()
    # subtle diagonal strata (tile in x: period divides 256)
    strata = 0.5 + 0.5 * np.sin((x * 2 * np.pi / 128) + y / 37.0)
    rgb *= (0.93 + 0.07 * strata)[..., None]
    # top highlight line + glow
    line = np.exp(-((y - 3) ** 2) / 4.0)
    glow = np.exp(-np.clip(y - 3, 0, None) / 18.0) * 0.55
    hi = np.array([110, 235, 255], np.float32)
    rgb = rgb + (hi - rgb) * np.clip(line + glow * 0.45, 0, 1)[..., None]
    a = np.full((H_, W_, 1), 255.0)
    img = np.concatenate([rgb, a], 2)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "ground.png"), optimize=True)
    print("wrote ground")


def plat(name, hi_hex, cracks=False):
    W_, H_ = 256, 64
    y = np.arange(H_)[:, None].astype(np.float32)
    x = np.arange(W_)[None, :].astype(np.float32)
    base = np.array([24, 18, 60], np.float32)
    rgb = np.broadcast_to(base * (1 - 0.45 * y[..., None] / H_), (H_, W_, 3)).copy()
    hi = np.array(rgba(hi_hex)[:3], np.float32)
    line = np.exp(-((y - 3) ** 2) / 4.0) + np.exp(-np.clip(y - 3, 0, None) / 10.0) * 0.25
    rgb = rgb + (hi - rgb) * np.clip(line, 0, 1)[..., None]
    alpha = np.where(y < H_ - 6, 255, 255 * (H_ - y) / 6)
    alpha = np.broadcast_to(alpha, (H_, W_))
    img = Image.fromarray(np.clip(np.concatenate([rgb, alpha[..., None]], 2), 0, 255).astype(np.uint8), "RGBA")
    if cracks:
        d = ImageDraw.Draw(img)
        for xs in (40, 128, 210):
            d.line([(xs, 6), (xs + 8, 22), (xs - 4, 38), (xs + 6, 58)], fill=rgba(hi_hex, 170), width=2)
    img.save(os.path.join(OUT, name + ".png"), optimize=True)
    print("wrote", name)


def emitter():
    c = Canvas(104, 76)
    c.rect((14, 16, 90, 60), rgba("#1a1440"), 10)
    c.ellipse((40, 26, 64, 50), rgba("#ff4f7a"))
    c.ellipse((46, 32, 58, 44), rgba("#ffe2ea"))
    img = c.result()
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((14, 16, 90, 60), radius=10, outline=rgba("#ff8fb0", 200), width=2)
    save(with_glow(img, "#ff4f7a", 6, 0.6), "emitter")


# ------------------------------------------------------------ particles ---
def particles():
    S = 64
    y, x = np.mgrid[0:S, 0:S].astype(np.float32)
    r = np.sqrt((x - S / 2 + .5) ** 2 + (y - S / 2 + .5) ** 2) / (S / 2)
    a = np.clip(1 - r, 0, 1) ** 2.2
    img = np.zeros((S, S, 4), np.float32)
    img[..., :3] = 255
    img[..., 3] = a * 255
    Image.fromarray(img.astype(np.uint8), "RGBA").save(os.path.join(OUT, "dot.png"))
    # 4-point sparkle
    c = Canvas(64, 64)
    m = 32
    c.poly([(m, 2), (m + 5, m - 5), (62, m), (m + 5, m + 5), (m, 62), (m - 5, m + 5), (2, m), (m - 5, m - 5)], rgba("#ffffff"))
    save(with_glow(c.result(), "#ffffff", 4, 0.8), "sparkle")
    # shard
    c = Canvas(40, 40)
    c.poly([(6, 34), (20, 4), (34, 30)], rgba("#ffffff"))
    save(c.result(), "shard")


# ----------------------------------------------------------------- icons --
def icons():
    def icon(name, drawfn):
        c = Canvas(96, 96)
        drawfn(c)
        save(c.result(), name)

    W = rgba("#ffffff")
    icon("i_pause", lambda c: (c.rect((30, 24, 42, 72), W, 3), c.rect((54, 24, 66, 72), W, 3)))
    icon("i_play", lambda c: c.poly([(34, 22), (74, 48), (34, 74)], W))

    def speaker(c, muted):
        c.poly([(18, 38), (32, 38), (50, 22), (50, 74), (32, 58), (18, 58)], W)
        if muted:
            c.line([(60, 36), (80, 60)], W, 6)
            c.line([(80, 36), (60, 60)], W, 6)
        else:
            for rr in (14, 26):
                c.d.arc(((50 - rr) * SS, (48 - rr) * SS, (50 + rr) * SS, (48 + rr) * SS), -45, 45, fill=W, width=6 * SS)
    icon("i_sound", lambda c: speaker(c, False))
    icon("i_mute", lambda c: speaker(c, True))

    def replay(c):
        c.d.arc((22 * SS, 22 * SS, 74 * SS, 74 * SS), 40, 330, fill=W, width=7 * SS)
        c.poly([(64, 14), (80, 32), (58, 36)], W)
    icon("i_replay", replay)
    icon("i_home", lambda c: (c.poly([(48, 16), (82, 46), (72, 46), (72, 78), (24, 78), (24, 46), (14, 46)], W),
                             c.rect((41, 56, 55, 78), rgba("#000000", 0))))


if __name__ == "__main__":
    player()
    gem()
    gem("gem_big", "#ffe9ff", "#ff8be0", "#c040c0", "#ff7ad9")
    spikes()
    saw()
    stalactite()
    wall()
    ground()
    plat("plat", "#6eebff")
    plat("plat_crumble", "#ff9ad9", cracks=True)
    emitter()
    particles()
    icons()
