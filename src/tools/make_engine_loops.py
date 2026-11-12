"""make_engine_loops.py -- cut the car's two engine loops from a real recording (CC0).

Source: "auto5.wav" by escortmarius, https://freesound.org/people/escortmarius/sounds/141459/ (a 1985 Ford Escort
Mk3 pulling away from a traffic light and driving on), CC0 1.0. Its HQ preview (128 kbit/s MP3) is the input:
  https://cdn.freesound.org/previews/141/141459_2527354-hq.mp3

Two steady stretches become loops (the game pitches them to the engine speed it wants):
  car-engine-idle.mp3   idling at about 51 Hz firing frequency (about 1,530 rpm), from 8.8 s
  car-engine-load.mp3   pulling under throttle at about 116 Hz (about 3,470 rpm), from 49.0 s

Each loop is a segment of about 2.5 s whose first 0.3 s are crossfaded with the audio after its end, so its end runs
into its start. The file carries 60 ms of the loop's own wrap-around on both sides ([tail][loop][head]) and the game
loops from 60 ms to 60 ms + the loop's length (ENGINE_LOOPS in src/js/game-1-core.js holds `n` and `hz` from this
script's output), so the seam stays clean whether or not a browser's MP3 decoder trims the encoder delay.
Mono, 44.1 kHz, 64 kbit/s MP3, peak at -2 dBFS each.

Run with Blender's Python (numpy + aud), then repack with src/tools/pack_sounds.py:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -t 4 --python src/tools/make_engine_loops.py -- PATH/141459_2527354-hq.mp3 src/assets/sounds
"""
import sys, os, json
import numpy as np
import aud

SRC, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
SR = 44100
PAD = 2646            # samples of wrap-around on each side (60 ms)
LOOPS = [('car-engine-idle', 8.8, 3.6), ('car-engine-load', 49.0, 5.6)]   # name, window start (s), window length (s)
L, X = 2.5, .3        # loop length and crossfade (s)


def ncorr(a, b):
    a = a - a.mean(); b = b - b.mean(); return float((a * b).sum() / max(np.sqrt((a * a).sum() * (b * b).sum()), 1e-12))


def f0(x):
    """median firing frequency (Hz) over 0.25 s blocks, by autocorrelation between 35 and 320 Hz"""
    out = []
    for i in range(0, len(x) - 11025, 5512):
        s = x[i:i + 11025] - x[i:i + 11025].mean(); sp = np.fft.rfft(s * np.hanning(len(s)), 2 * len(s)); ac = np.fft.irfft(np.abs(sp) ** 2)[:len(s)]
        a, b = int(SR / 320), int(SR / 35); k = a + int(np.argmax(ac[a:b])); f = SR / k
        while f < 80 and ac[max(1, int(k / 2))] > .8 * ac[k]: k //= 2; f = SR / k   # prefer the fundamental over a sub-multiple
        out.append(f)
    return float(np.median(out))


s = aud.Sound(SRC); assert int(s.specs[0]) == SR, s.specs
x = s.data().mean(axis=1).astype(np.float64)
for name, w0, wl in LOOPS:
    seg = x[int(w0 * SR):int((w0 + wl) * SR)]; n, xf = int(L * SR), int(X * SR); best = (-2, 0, 0)
    for a in range(0, len(seg) - n - xf - int(.05 * SR), int(.02 * SR)):
        for dn in range(-int(.03 * SR), int(.03 * SR), 5):
            m = n + dn; c = ncorr(seg[a:a + xf], seg[a + m:a + m + xf])
            if c > best[0]: best = (c, a, m)
    c, a, m = best; t = np.arange(xf) / xf
    gi, go = (t, 1 - t) if c > .6 else (np.sin(np.pi / 2 * t), np.cos(np.pi / 2 * t))
    body = seg[a:a + m].copy(); body[:xf] = seg[a:a + xf] * gi + seg[a + m:a + m + xf] * go
    body *= 10 ** (-2 / 20) / np.abs(body).max()
    y = np.concatenate([body[-PAD:], body, body[:PAD]]).astype(np.float32)
    path = os.path.join(OUT, name + '.mp3')
    aud.Sound.buffer(np.ascontiguousarray(y.reshape(-1, 1)), SR).write(path, rate=SR, channels=aud.CHANNELS_MONO, format=aud.FORMAT_S16,
                                                                       container=aud.CONTAINER_MP3, codec=aud.CODEC_MP3, bitrate=64000)
    d = aud.Sound(path).data()[:, 0]
    print(json.dumps({'name': name, 'from_s': round(w0 + a / SR, 3), 'n': m, 'hz': round(f0(body), 1), 'corr': round(c, 3), 'decoded_len': len(d), 'len': len(y),
                      'rms_db': round(float(20 * np.log10(np.sqrt(np.mean(body ** 2)))), 1), 'kb': round(os.path.getsize(path) / 1024, 1)}))
