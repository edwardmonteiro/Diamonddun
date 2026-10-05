"""Synthesised soundtrack + SFX for Diamond Dash (100% original, no samples).

Run: python3 tools/gen_audio.py  -> public/assets/audio/*.ogg
Needs numpy, scipy, ffmpeg.
"""
import os
import subprocess
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets", "audio")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(3)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def t_(d):
    return np.arange(int(d * SR)) / SR


def env_adsr(n, a, d, s, r, sustain_len=None):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    hold = max(n - a - d - r, 0)
    e = np.concatenate([np.linspace(0, 1, max(a, 1)), np.linspace(1, s, max(d, 1)),
                        np.full(hold, s), np.linspace(s, 0, max(r, 1))])
    e = e[:n]
    return np.pad(e, (0, n - len(e)))


def lp(x, fc, order=2):
    sos = butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def hp(x, fc, order=2):
    sos = butter(order, fc, "high", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def bp(x, lo, hi, order=2):
    sos = butter(order, [lo, min(hi, SR * 0.45)], "band", fs=SR, output="sos")
    return sosfilt(sos, x, axis=0)


def saw(f, t, phase=0):
    """Band-limited-ish saw via additive partials (cheap PolyBLEP alternative)."""
    out = np.zeros_like(t)
    nmax = int(min(40, (SR / 2.2) / max(f, 1)))
    for k in range(1, nmax + 1):
        out += np.sin(2 * np.pi * k * f * t + phase * k) / k
    return out * (2 / np.pi)


def reverb_ir(seconds=2.8, decay=3.2, stereo=True):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    chans = []
    for c in range(2 if stereo else 1):
        noise = rng.standard_normal(n)
        noise = lp(noise, 6500)
        ir = noise * np.exp(-decay * t)
        ir[:int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        chans.append(ir / np.sqrt(np.sum(ir ** 2)))
    return np.stack(chans, 1)


IR = reverb_ir()
IR_SHORT = reverb_ir(1.1, 6.0)


def reverb(x, wet=0.3, ir=IR):
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[:len(x)] for c in range(2)], 1)
    return x * (1 - wet) + y * wet


def to_stereo(x, pan=0.0):
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    return np.stack([x * l, x * r], 1)


def write(name, x, q=5, peak=0.89):
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    raw = os.path.join(OUT, name + ".raw")
    (x.astype(np.float32)).tofile(raw)
    dst = os.path.join(OUT, name + ".ogg")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "2",
                    "-i", raw, "-c:a", "libvorbis", "-q:a", str(q), dst], check=True)
    os.remove(raw)
    print("wrote", name, f"{len(x) / SR:.2f}s")


# =================================================================== MUSIC ==
BPM = 104
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 32
LEN = BAR * BARS
N = int(LEN * SR)

# A minor journey: Am  F  C  G | Am  F  Dm  E(sus->maj)
PROG = [
    [57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67],
    [57, 60, 64, 69], [53, 57, 60, 65], [50, 57, 62, 65], [52, 56, 59, 64],
]
ROOTS = [45, 41, 48, 43, 45, 41, 38, 40]


def place(buf, sig, start):
    """Add sig into buf at sample index start, wrapping around (seamless loop)."""
    n = len(sig)
    i = int(start) % len(buf)
    end = i + n
    if end <= len(buf):
        buf[i:end] += sig
    else:
        k = len(buf) - i
        buf[i:] += sig[:k]
        rest = sig[k:]
        while len(rest):
            m = min(len(rest), len(buf))
            buf[:m] += rest[:m]
            rest = rest[m:]


def music():
    mix = np.zeros((N, 2))

    # --- pads: detuned saws, slow filter swell, one chord per bar
    pad = np.zeros((N, 2))
    for bar in range(BARS):
        chord = PROG[bar % 8]
        d = BAR + 1.2
        t = t_(d)
        voice = np.zeros((len(t), 2))
        for i, n in enumerate(chord):
            for det, pan in ((-0.09, -0.6), (0.0, 0.0), (0.08, 0.6)):
                f = midi(n + det)
                v = saw(f, t, rng.uniform(0, 6.28)) * 0.08
                voice += to_stereo(v, pan * (0.5 + i * 0.15))
        fc = 900 + 1400 * (0.5 - 0.5 * np.cos(2 * np.pi * np.minimum(t / BAR, 1)))
        voice = lp(voice, 2200)
        e = env_adsr(len(t), 0.9, 0.5, 0.8, 1.2)
        voice *= e[:, None]
        place(pad, voice, bar * BAR * SR)
    mix += pad * 0.55

    # --- arpeggio pluck (16ths), enters bar 4; ping-pong
    arp = np.zeros((N, 2))
    pattern = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2]
    for bar in range(4, BARS):
        chord = PROG[bar % 8]
        for s in range(16):
            n = chord[pattern[s]] + 12 + (12 if (s % 8 == 7 and bar % 2) else 0)
            d = 0.5
            t = t_(d)
            f = midi(n)
            x = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t + 0.3)
                 + 0.12 * np.sin(2 * np.pi * 3.01 * f * t)) * np.exp(-t * 9)
            x *= 0.16 * (1.0 if s % 4 == 0 else 0.72)
            place(arp, to_stereo(x, -0.45 if s % 2 else 0.45), (bar * BAR + s * BEAT / 4) * SR)
    # delay (dotted 8th) feedback
    dly = int(BEAT * 0.75 * SR)
    for k, g in enumerate([0.42, 0.24, 0.13]):
        sh = np.roll(arp, dly * (k + 1), axis=0)[:, ::-1 if k % 2 == 0 else 1]
        arp = arp + sh * g
    mix += lp(arp, 5200) * 0.8

    # --- sub bass, enters bar 8: syncopated 8ths
    bass = np.zeros((N, 2))
    bpat = [1, 0, 0, 1, 0, 0, 1, 0]
    for bar in range(8, BARS):
        r = ROOTS[bar % 8]
        for s in range(8):
            if not bpat[s]:
                continue
            d = BEAT * (0.9 if s != 6 else 0.45)
            t = t_(d)
            f = midi(r)
            x = np.sin(2 * np.pi * f * t) + 0.25 * saw(f, t)
            x = lp(x, 420) * env_adsr(len(t), 0.005, 0.08, 0.85, 0.06)
            place(bass, to_stereo(x * 0.42), (bar * BAR + s * BEAT / 2) * SR)
    mix += bass

    # --- drums, enter bar 8 (kick/clap) & 16 (hats get busier)
    drums = np.zeros((N, 2))
    kick_t = t_(0.45)
    kick = np.sin(2 * np.pi * (48 * kick_t + 140 / 30 * (1 - np.exp(-30 * kick_t)))) * np.exp(-kick_t * 7)
    kick += 0.3 * np.exp(-kick_t * 200) * rng.standard_normal(len(kick_t))
    clap_t = t_(0.35)
    clap = bp(rng.standard_normal(len(clap_t)), 900, 4200) * (np.exp(-clap_t * 18))
    for burst in (0.008, 0.016):
        clap[:int(burst * SR)] *= 1.3
    hat_t = t_(0.08)
    hat = hp(rng.standard_normal(len(hat_t)), 7500) * np.exp(-hat_t * 60)
    ohat_t = t_(0.3)
    ohat = hp(rng.standard_normal(len(ohat_t)), 6500) * np.exp(-ohat_t * 12)
    for bar in range(8, BARS):
        breakdown = bar in (23,)  # tiny breath before the drop
        for b in range(4):
            st = (bar * BAR + b * BEAT) * SR
            if not breakdown or b < 2:
                place(drums, to_stereo(kick * 0.85), st)
            if b in (1, 3) and not breakdown:
                place(drums, to_stereo(clap * 0.32, 0.1), st)
        for s in range(16 if bar >= 16 else 8):
            step = BEAT / (4 if bar >= 16 else 2)
            st = (bar * BAR + s * step) * SR
            acc = 1.0 if s % 2 == 0 else 0.6
            if bar >= 16 and s % 4 == 2:
                place(drums, to_stereo(ohat * 0.10, -0.3), st)
            else:
                place(drums, to_stereo(hat * 0.11 * acc, 0.35), st)
    # sidechain pump on pads/arp/bass
    pump = np.ones(N)
    beatlen = int(BEAT * SR)
    shape = 1 - 0.55 * np.exp(-np.arange(beatlen) / (0.11 * SR))
    for i in range(int(8 * BAR * SR), N - beatlen, beatlen):
        pump[i:i + beatlen] = shape[:len(pump[i:i + beatlen])]
    mix *= pump[:, None]
    mix += drums

    # --- shimmering lead motif in second half
    lead = np.zeros((N, 2))
    motif = [(0, 76, 1.5), (1.5, 74, 0.5), (2, 72, 1), (3, 71, 1), (4, 69, 2), (6, 72, 1), (7, 74, 1),
             (8, 76, 1.5), (9.5, 79, 0.5), (10, 77, 2), (12, 76, 1), (13, 74, 1), (14, 71, 2)]
    for rep in (16, 24):
        for (b, n, d) in motif:
            dur = d * BEAT + 0.4
            t = t_(dur)
            f = midi(n)
            vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip(t * 3, 0, 1)
            ph = 2 * np.pi * f * np.cumsum(vib) / SR
            x = (np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)) * env_adsr(len(t), 0.03, 0.2, 0.7, 0.35)
            place(lead, to_stereo(x * 0.11, 0.15), (rep * BAR + b * BEAT) * SR)
    mix += lp(lead, 4000)

    # glue: reverb (wrapped tail for seamless loop) + soft clip
    wet = np.zeros_like(mix)
    for c in range(2):
        full = fftconvolve(mix[:, c], IR[:, c])
        wet[:, c] = full[:N]
        tail = full[N:]
        wet[:len(tail), c] += tail[:N]
    out = mix * 0.78 + wet * 0.32
    out = hp(out, 28)
    out = np.tanh(out * 1.4) / np.tanh(1.4)
    write("music", out, q=5, peak=0.82)


# ============================================================== MENU THEME ==
def menu():
    """Calm, spacious pad + glass bells for the title screen (seamless)."""
    n = int(BAR * 8 * SR)
    buf = np.zeros((n, 2))
    chords = [[57, 64, 67, 71], [53, 60, 64, 69], [48, 55, 62, 64], [55, 62, 66, 69]]
    for i in range(8):
        ch = chords[i % 4]
        t = t_(BAR * 2 + 2)
        v = np.zeros((len(t), 2))
        for j, nn in enumerate(ch):
            for det in (-0.07, 0.07):
                v += to_stereo(np.sin(2 * np.pi * midi(nn + det) * t) * 0.09
                               + saw(midi(nn + det), t) * 0.025, det * 8)
        v *= env_adsr(len(t), 1.8, 0.5, 0.75, 2.0)[:, None]
        place(buf, lp(v, 1800), i * BAR * SR)
    bells = [81, 76, 79, 74, 83, 79, 76, 72]
    for i in range(32):
        if rng.random() < 0.55:
            nn = bells[rng.integers(0, len(bells))]
            t = t_(2.5)
            f = midi(nn)
            x = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 3)) * np.exp(-t * 1.8)
            place(buf, to_stereo(x * 0.07, rng.uniform(-0.8, 0.8)), i * BEAT * SR)
    wet = np.zeros_like(buf)
    for c in range(2):
        full = fftconvolve(buf[:, c], IR[:, c])
        wet[:, c] = full[:n]
        tail = full[n:]
        wet[:len(tail), c] += tail[:n]
    write("menu", buf * 0.6 + wet * 0.5, q=4, peak=0.7)


# ===================================================================== SFX ==
def sfx():
    # jump: rounded upward chirp
    t = t_(0.22)
    f = 320 + 520 * (1 - np.exp(-t * 22))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_adsr(len(t), 0.003, 0.05, 0.4, 0.14)
    x += 0.3 * np.sin(2 * np.pi * np.cumsum(f * 2) / SR) * np.exp(-t * 30)
    write("jump", reverb(lp(x, 4000), 0.18, IR_SHORT), peak=0.55)

    # double jump: airy sparkle
    t = t_(0.32)
    f = 600 + 900 * (1 - np.exp(-t * 16))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11)
    x += bp(rng.standard_normal(len(t)), 3000, 9000) * np.exp(-t * 14) * 0.25
    write("djump", reverb(x, 0.3, IR_SHORT), peak=0.5)

    # dash: whoosh + sub thump
    t = t_(0.5)
    noise = rng.standard_normal(len(t))
    sweep = np.zeros_like(t)
    fc = 600 + 5000 * np.exp(-t * 7)
    # time-varying filter by block processing
    blk = 512
    for i in range(0, len(t), blk):
        seg = noise[max(0, i - 256):i + blk]
        y = bp(seg, max(fc[i] * 0.5, 120), fc[i] * 1.6)
        sweep[i:i + blk] = y[-len(sweep[i:i + blk]):]
    sweep *= env_adsr(len(t), 0.01, 0.12, 0.35, 0.3)
    thump = np.sin(2 * np.pi * (70 * t + 90 / 25 * (1 - np.exp(-25 * t)))) * np.exp(-t * 14)
    write("dash", reverb(sweep * 0.8 + thump * 0.9, 0.2, IR_SHORT), peak=0.7)

    # diamond pickup: glassy bell, 6 pitches climbing pentatonic (combo)
    for i, n in enumerate([84, 86, 88, 91, 93, 96]):
        t = t_(0.9)
        f = midi(n)
        x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 6)
             + 0.45 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 9)
             + 0.25 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t * 14)
             + 0.18 * np.sin(2 * np.pi * f * 4.2 * t) * np.exp(-t * 22))
        x *= np.clip(t / 0.002, 0, 1)
        sparkle = hp(rng.standard_normal(len(t)), 9000) * np.exp(-t * 40) * 0.15
        write(f"gem{i}", reverb(x + sparkle, 0.32), peak=0.5)

    # crystal wall shatter
    t = t_(1.0)
    x = np.zeros_like(t)
    for _ in range(26):
        st = int(rng.uniform(0, 0.12) * SR)
        f = rng.uniform(1800, 7200)
        d = np.exp(-(t[:len(t) - st]) * rng.uniform(10, 30))
        x[st:] += np.sin(2 * np.pi * f * t[:len(t) - st]) * d * rng.uniform(0.2, 0.6)
    crack = hp(rng.standard_normal(len(t)), 1500) * np.exp(-t * 25)
    boom = np.sin(2 * np.pi * (55 * t + 60 / 18 * (1 - np.exp(-18 * t)))) * np.exp(-t * 9)
    write("shatter", reverb(x * 0.35 + crack * 0.6 + boom * 0.7, 0.3), peak=0.75)

    # land: soft thud
    t = t_(0.16)
    x = np.sin(2 * np.pi * (90 * t + 80 / 40 * (1 - np.exp(-40 * t)))) * np.exp(-t * 30)
    x += lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 50) * 0.4
    write("land", x, peak=0.35)

    # death: downward glitch + boom + shimmer
    t = t_(1.4)
    f = 700 * np.exp(-t * 3.2) + 40
    tone = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.4
    tone = lp(tone, 2500) * np.exp(-t * 3)
    boom = np.sin(2 * np.pi * (40 * t + 120 / 12 * (1 - np.exp(-12 * t)))) * np.exp(-t * 4)
    nz = lp(rng.standard_normal(len(t)), 1800) * np.exp(-t * 6) * 0.5
    write("death", reverb(tone + boom + nz, 0.35), peak=0.8)

    # ui tap
    t = t_(0.12)
    x = np.sin(2 * np.pi * 1320 * t) * np.exp(-t * 45) + 0.4 * np.sin(2 * np.pi * 2640 * t) * np.exp(-t * 70)
    write("tap", reverb(x, 0.2, IR_SHORT), peak=0.4)

    # new record fanfare: arpeggiated major bells
    t_all = t_(2.2)
    x = np.zeros_like(t_all)
    for i, n in enumerate([72, 76, 79, 84, 88]):
        st = int(i * 0.09 * SR)
        tt = t_all[:len(t_all) - st]
        f = midi(n)
        x[st:] += (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * 2 * f * tt) * np.exp(-tt * 6)) * np.exp(-tt * 2.6)
    write("record", reverb(x, 0.4), peak=0.55)

    # trap warning tick (lasers / falling spikes)
    t = t_(0.09)
    x = np.sin(2 * np.pi * 2200 * t) * np.exp(-t * 60)
    write("tick", x, peak=0.25)

    # laser hum burst
    t = t_(0.6)
    x = (saw(110, t) * 0.5 + np.sin(2 * np.pi * 220 * t)) * (1 + 0.5 * np.sin(2 * np.pi * 30 * t))
    x = lp(x, 1800) * env_adsr(len(t), 0.02, 0.1, 0.7, 0.25)
    write("laser", reverb(x, 0.15, IR_SHORT), peak=0.35)


if __name__ == "__main__":
    sfx()
    menu()
    music()
