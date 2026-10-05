"""Procedural, seamless parallax backgrounds for Diamond Dash.

Every layer tiles horizontally (all noise is built from integer-period
Fourier terms), so Phaser TileSprites can scroll them forever.
Run:  python3 tools/gen_art.py   -> writes public/assets/bg/*.png
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter

W, H = 2048, 720
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "bg")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def hexc(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def periodic_1d(n_terms, base_amp, falloff, seed, w=W):
    r = np.random.default_rng(seed)
    x = np.arange(w) / w * 2 * np.pi
    y = np.zeros(w)
    for k in range(1, n_terms + 1):
        y += base_amp * (falloff ** (k - 1)) * np.sin(k * x + r.uniform(0, 2 * np.pi)) * r.uniform(0.6, 1.0)
    return y


def periodic_2d(h, w, terms, seed):
    """Seamless-in-x smooth noise field in [-1,1]."""
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    f = np.zeros((h, w), np.float32)
    for _ in range(terms):
        kx = r.integers(1, 7)
        ky = r.uniform(0.5, 4.0)
        ph1, ph2 = r.uniform(0, 2 * np.pi, 2)
        f += np.sin(kx * xx / w * 2 * np.pi + ph1 + np.sin(ky * yy / h * 2 * np.pi + ph2) * 1.4) * r.uniform(0.3, 1)
    f /= np.abs(f).max() + 1e-6
    return f


def wrap_blur(img, sigma):
    """Gaussian blur that wraps in x (keeps tiles seamless)."""
    pad = int(sigma * 4) + 1
    if img.ndim == 2:
        p = np.concatenate([img[:, -pad:], img, img[:, :pad]], axis=1)
        return gaussian_filter(p, sigma)[:, pad:-pad]
    p = np.concatenate([img[:, -pad:], img, img[:, :pad]], axis=1)
    return gaussian_filter(p, (sigma, sigma, 0))[:, pad:-pad]


def dither(a):
    return a + rng.uniform(-1.2, 1.2, a.shape)


CROPS = {}


def save(rgba, name, crop=False):
    if crop:
        rows = np.where(rgba[..., 3].max(axis=1) > 2)[0]
        top = max(int(rows.min()) - 4, 0)
        rgba = rgba[top:]
        CROPS[name] = top
    rgba = np.clip(dither(rgba), 0, 255).astype(np.uint8)
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, name), optimize=True)
    print("wrote", name)


# ---------------------------------------------------------------- sky ----
def sky():
    t = np.linspace(0, 1, H)[:, None, None]
    top, mid, low = hexc("#05061a"), hexc("#1a1450"), hexc("#3b2a6e")
    horizon = hexc("#d46a8c")
    g = np.where(t < 0.55, top + (mid - top) * (t / 0.55), mid + (low - mid) * ((t - 0.55) / 0.45))
    glow = np.exp(-((t - 0.98) ** 2) / 0.02)
    img = g + (horizon - g) * glow * 0.55
    img = np.broadcast_to(img, (H, W, 3)).copy()

    # aurora ribbons
    x = np.arange(W)
    for i, (col, yc, amp, seed, strength) in enumerate([
        ("#3fffd2", 0.30, 70, 11, 0.55),
        ("#7a5cff", 0.22, 55, 12, 0.45),
        ("#ff5fb8", 0.40, 40, 13, 0.25),
    ]):
        center = yc * H + periodic_1d(5, amp, 0.6, seed)
        yy = np.arange(H)[:, None]
        d = (yy - center[None, :])
        band = np.exp(-(d ** 2) / (2 * 28 ** 2)) * (d < 0) + np.exp(-(d ** 2) / (2 * 9 ** 2)) * (d >= 0)
        curtain = 0.55 + 0.45 * periodic_2d(H, W, 6, seed + 50)
        streak = 0.6 + 0.4 * np.sin(x / W * 2 * np.pi * 90 + periodic_1d(3, 6, 0.5, seed + 9))[None, :]
        a = band * curtain * streak * strength
        img = img + (hexc(col)[None, None, :] - img) * a[..., None] * 0.9

    # nebula dust
    neb = periodic_2d(H, W, 14, 21) * 0.5 + 0.5
    neb = wrap_blur(neb, 12) ** 3
    img += hexc("#6a4cc9")[None, None, :] * neb[..., None] * 0.18 * (1 - t)

    # stars (wrap-safe)
    stars = np.zeros((H, W), np.float32)
    n = 1100
    sx = rng.integers(0, W, n)
    sy = (rng.beta(1.1, 2.6, n) * H * 0.85).astype(int)
    sb = rng.power(4, n)
    stars[sy, sx] = sb
    halo = wrap_blur(stars, 1.2) * 6
    big = np.zeros_like(stars)
    for _ in range(18):
        bx, by = rng.integers(0, W), int(rng.beta(1, 3) * H * 0.7)
        big[by, bx] = 1
    big = wrap_blur(big, 2.2) * 30
    s = np.clip(stars + halo + big, 0, 1.4)
    img = img + (np.array([235, 240, 255])[None, None, :] - img) * np.clip(s, 0, 1)[..., None]

    # big soft moon glow
    yy, xx = np.mgrid[0:H, 0:W]
    mx, my = W * 0.72, H * 0.2
    dx = np.minimum(np.abs(xx - mx), W - np.abs(xx - mx))
    r = np.sqrt(dx ** 2 + (yy - my) ** 2)
    disc = np.clip(1 - (r - 46) / 2.0, 0, 1)
    glow = np.exp(-r / 160) * 0.35
    moon = hexc("#f4eefe")
    img = img + (moon - img) * glow[..., None]
    limb = np.sqrt(np.clip(1 - (r / 46) ** 2, 0, 1))
    shade = (0.72 + 0.28 * limb) * (0.86 + 0.14 * wrap_blur(periodic_2d(H, W, 16, 5), 2) )
    img = img * (1 - disc[..., None]) + moon * shade[..., None] * disc[..., None]

    a = np.full((H, W, 1), 255.0)
    save(np.concatenate([img, a], 2), "sky.png")


# -------------------------------------------------- mountain silhouettes ----
def ridged(amp, seed, sharp):
    r = np.random.default_rng(seed)
    x = np.arange(W) / W * 2 * np.pi
    y = np.zeros(W)
    a = amp
    for k in (2, 3, 5, 8, 13, 21, 34, 55, 89):
        v = np.sin(k * x + r.uniform(0, 2 * np.pi))
        v = (1 - np.abs(v)) * 2 - 1 if sharp else v
        y += a * v * r.uniform(0.7, 1.0)
        a *= 0.55
    return y


def ridge(name, base, amp, terms, falloff, seed, color, fog, rim, crystals=0, peaks=False):
    h = base * H - ridged(amp, seed, peaks)
    yy = np.arange(H)[:, None].astype(np.float32)
    inside = yy >= h[None, :]
    depth = np.clip((yy - h[None, :]) / (H - h.min() + 1), 0, 1)
    col = hexc(color)
    fogc = hexc(fog)
    rgb = col[None, None, :] * (1 - depth[..., None] * 0.45) + fogc * np.exp(-depth[..., None] * 6) * 0.35
    # texture strata
    tex = periodic_2d(H, W, 10, seed + 70)
    rgb = rgb * (1 + 0.012 * tex[..., None])
    alpha = inside.astype(np.float32)
    # anti-alias edge
    edge = np.clip(yy - h[None, :] + 0.5, 0, 1)
    alpha = edge
    # rim light along crest
    dist = yy - h[None, :]
    rimmask = np.exp(-np.clip(dist, 0, None) / 3.5) * (dist >= -0.5)
    rgb = rgb + (hexc(rim) - rgb) * rimmask[..., None] * 0.5
    out = np.concatenate([rgb, alpha[..., None] * 255], 2)

    if crystals:
        layer = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        d = ImageDraw.Draw(layer)
        palette = ["#46f0ff", "#46f0ff", "#9b7bff", "#ff6fcf"]
        r = np.random.default_rng(seed + 100)
        for _ in range(crystals):
            cx = int(r.integers(0, W)) if _ % 3 == 0 else (cx + int(r.integers(-40, 40))) % W
            ground = h[cx % W]
            s = r.uniform(8, 22)
            tall = s * r.uniform(2.6, 5.0)
            lean = r.uniform(-0.35, 0.35)
            c = palette[r.integers(0, len(palette))]
            cr = hexc(c)
            for off in (-W, 0, W):
                x0 = cx + off
                pts = [(x0 - s * 0.5, ground + 8), (x0 - s * 0.32, ground - tall * 0.65),
                       (x0 + lean * tall, ground - tall), (x0 + s * 0.32, ground - tall * 0.6),
                       (x0 + s * 0.5, ground + 8)]
                cr = cr * 0.55 + hexc(color) * 0.45
                dark = tuple(int(v) for v in cr * 0.35) + (255,)
                light = tuple(int(v) for v in np.minimum(cr * 1.05, 255)) + (255,)
                d.polygon(pts, fill=dark)
                facet = [pts[1], pts[2], (x0 + lean * tall * 0.4, ground + 8), pts[0]]
                d.polygon(facet, fill=tuple(int(v) for v in cr * 0.7) + (255,))
                d.line([pts[1], pts[2], pts[3]], fill=light, width=2)
                gd.polygon(pts, fill=tuple(int(v) for v in cr) + (110,))
        garr = np.array(glow).astype(np.float32)
        garr = wrap_blur(garr, 22) * 1.0
        larr = np.array(layer).astype(np.float32)
        # composite glow beneath crystals (additive-ish on alpha)
        ga = garr[..., 3:4] / 255
        la = larr[..., 3:4] / 255
        rgb = larr[..., :3] * la + garr[..., :3] * ga * (1 - la)
        a = la + ga * (1 - la)
        rgb = rgb / np.maximum(a, 1e-4)
        out = np.concatenate([rgb, a * 255], 2)
    save(out, name, crop=True)


# ------------------------------------------------- foreground mist strip ----
def mist():
    yy = np.arange(H)[:, None].astype(np.float32) / H
    n = periodic_2d(H, W, 12, 99) * 0.5 + 0.5
    n = wrap_blur(n, 6)
    a = np.clip((yy - 0.55) / 0.45, 0, 1) ** 1.6 * (0.35 + 0.65 * n) * 0.32
    rgb = np.broadcast_to(hexc("#6f58c8"), (H, W, 3)).copy()
    save(np.concatenate([rgb, a[..., None] * 255], 2), "mist.png", crop=True)


if __name__ == "__main__":
    sky()
    ridge("far.png", 0.60, 95, 9, 0.62, 31, "#352d72", "#9a7fd0", "#cdb4ff", peaks=True)
    ridge("mid.png", 0.70, 80, 12, 0.68, 41, "#221a55", "#7a5fc4", "#7feaff", crystals=36, peaks=True)
    ridge("near.png", 0.84, 55, 14, 0.7, 52, "#09071a", "#2a1f5c", "#ff8ad9", crystals=0, peaks=False)
    mist()
    import json
    with open(os.path.join(OUT, "..", "..", "..", "src", "bgcrops.json"), "w") as f:
        json.dump({k.replace(".png", ""): v for k, v in CROPS.items()}, f)
    print(CROPS)
