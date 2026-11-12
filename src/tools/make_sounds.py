"""
make_sounds.py -- build the RC Office Campus sound effects from raw CC0 recordings.

Outputs (written to src/assets/sounds/ by default; their credit lines are printed. src/assets/sounds/CREDITS.md is
edited by hand, because it also credits the car sounds from make_car_sounds.py and make_engine_loops.py):
  car-horn.mp3                        one short horn beep
  dog-bark-1.mp3 .. dog-bark-3.mp3    one bark each
  cat-meow-1.mp3 .. cat-meow-3.mp3    one meow each

Every output is mono, 44.1 or 48 kHz (the source's own rate, so nothing is
resampled), 64 kbit/s MP3, starts at most ~20 ms before the sound, ends with a
short fade-out and peaks at about -1 dBFS. All sources are CC0 1.0 (see CLIPS).

Run it with Blender's bundled Python and FFmpeg (no system ffmpeg needed):

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -t 4 \
      --python src/tools/make_sounds.py -- [--out DIR] [--only NAME,...] [--keep-temp] RAW [RAW ...]

  RAW          raw download files and/or folders (folders are searched recursively).
               Each clip in CLIPS names its source by file name; the first match wins.
  --out        output folder (default: ../assets/sounds next to this script)
  --only       comma-separated output names to rebuild, e.g. car-horn.mp3 (default: all)
  --keep-temp  keep the intermediate WAV files and print their folder

The script is re-runnable: it never modifies the raw files and overwrites its outputs.
It prints one JSON line per output (timing, gain, peaks, size) and a summary table.

How each clip is made
  1. Decode. The source is decoded with Blender's audio library (aud), mixed to
     mono and written as a 32-bit PCM WAV at its native rate with 6 dB of headroom.
     The sequencer then works from that WAV. Decoding here rather than in a strip
     matters for MP3 sources: a sound strip that starts inside an MP3 loses about
     400 samples to decoder priming after the seek, and Blender also shifts MP3
     strips by the stream start time (about 23 ms), which would cut the horn's
     attack. Strips made from PCM WAV files are sample-exact.
  2. Find the cut. A one-shot starts 20 ms before the first 1 ms block that comes
     within 30 dB of the clip's peak inside the clip's search window. The end and
     the fade-out length come from CLIPS (chosen from measured envelopes). For the
     motor loop, the start and the loop length are picked where the two crossfade
     regions correlate best; the length is a whole number of 1152-sample MP3
     frames (24 ms at 48 kHz), so the encoder adds no padding inside the loop.
  3. Sequencer. The scene runs at 1000 fps (1 frame = 1 ms). The WAV is added as a
     sound strip; the content position and the left/right handles do the trim, and
     keyframed strip volume does a 3 ms fade-in, a cosine fade-out and, for the
     loop, an equal-power crossfade between the loop body and a second strip that
     carries the audio following the loop end:
         out[t] = body[t] * sin(pi/2 * t/X) + after_end[t] * cos(pi/2 * t/X),  t < X
     so out[last] -> out[0] continues the recording without a seam.
  4. Normalize. The clip is mixed down to WAV at volume 0.5, read with the wave
     module, and its peak measured; the clip is then rebuilt with the strip volume
     that puts the peak at -1 dBFS.
  5. Encode. bpy.ops.sound.mixdown(container='MP3', codec='MP3', format='S16',
     channels='MONO', bitrate=64, mixrate=<native rate>).
  6. Verify. The MP3 is decoded with aud (exact sample count and peak) and also
     mixed back through a sound strip to WAV (peak). MP3 encoding moves the peak a
     little (usually down, as the encoder low-passes); if the decoded peak misses
     -1 dBFS by more than 0.3 dB, the clip is re-encoded once with corrected gain.
"""

import argparse
import json
import math
import os
import shutil
import sys
import tempfile
import wave

import aud
import bpy
import numpy as np

FPS = 1000             # 1 sequencer frame = 1 ms
TARGET_DB = -1.0       # peak target
PEAK_TOL_DB = 0.3      # re-encode once if the decoded MP3 peak misses the target by more
LEAD_S = 0.020         # pre-roll kept before a one-shot's onset
ONSET_DB = 30.0        # onset = first 1 ms block within this many dB of the clip peak
FADE_IN_S = 0.003      # click guard at the very start of a one-shot
BITRATE = 64           # kbit/s
MP3_FRAME = 1152       # samples per MPEG-1 Layer III frame
CURVE_STEP = 5         # frames (ms) between keyframes on fade curves

FS = 'https://freesound.org/people/'
CC0 = 'CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)'

# One entry per output. Times are seconds in the source recording.
#   search    window in which the one-shot's onset is looked for
#   end       where the clip ends; fade_out = length of the closing fade
#   loop      start window, loop-length window and crossfade length for a loop
CLIPS = [
    dict(out='car-horn.mp3', src='Julien_Matthey_436589_mini_countryman_horn.mp3',
         search=(0.0, 0.30), end=0.66, fade_out=0.08,
         title='JM_TRANSPORT_EXT_Horn 01a - Car_Short_Mini Countryman.wav', author='Julien_Matthey',
         url=FS + 'Julien_Matthey/sounds/436589/', license=CC0),
    dict(out='dog-bark-1.mp3', src='fs277058_kwahmah02_single_dog_bark.ogg',
         search=(0.0, 0.10), end=0.24, fade_out=0.05,
         title='Single Dog Bark', author='kwahmah_02',
         url=FS + 'kwahmah_02/sounds/277058/', license=CC0),
    dict(out='dog-bark-2.mp3', src='fs630648_haulaway_single_bark_small_medium.ogg',
         search=(0.60, 0.85), end=1.04, fade_out=0.07,
         title='single bark - small to medium dog', author='haulaway',
         url=FS + 'haulaway/sounds/630648/', license=CC0),
    dict(out='dog-bark-3.mp3', src='fs850823_sadiquecat_dog_bark_2.ogg',
         search=(0.0, 0.10), end=0.30, fade_out=0.10,
         title='Dog bark 2', author='Sadiquecat',
         url=FS + 'Sadiquecat/sounds/850823/', license=CC0),
    dict(out='cat-meow-1.mp3', src='cat_meow_kitten_mafon2_cc0_hqpreview.ogg',
         search=(0.0, 0.10), end=0.57, fade_out=0.05,
         title='Cat Meow', author='Mafon2',
         url=FS + 'Mafon2/sounds/436541/', license=CC0),
    dict(out='cat-meow-2.mp3', src='cat_meow_niaou_tsester_cc0.flac',
         search=(0.05, 0.30), end=0.98, fade_out=0.08,
         title='2015-11-24.\u03bd\u03b9\u03b1\u03bf\u03cd\u03c1\u03b9\u03c3\u03bc\u03b1.'
               '\u039d\u03b9\u03ac\u03bf\u03c5.noise reduced.flac',
         author='Tsester (Wikimedia Commons)',
         url='https://commons.wikimedia.org/wiki/File:2015-11-24.%CE%BD%CE%B9%CE%B1%CE%BF%CF%8D'
             '%CF%81%CE%B9%CF%83%CE%BC%CE%B1.%CE%9D%CE%B9%CE%AC%CE%BF%CF%85.noise_reduced.flac',
         license=CC0),
    dict(out='cat-meow-3.mp3', src='cat_meow_siamese_freemaster2_cc0.wav',
         search=(0.0, 0.30), end=1.10, fade_out=0.07,
         title='Meow of a Siamese cat - freemaster2.wav',
         author='freemaster2 (via Wikimedia Commons; originally Freesound sound 66518)',
         url='https://commons.wikimedia.org/wiki/File:Meow_of_a_Siamese_cat_-_freemaster2.wav',
         license=CC0),
]


# ---------------------------------------------------------------- helpers

def db(v):
    return 20.0 * math.log10(max(float(v), 1e-12))


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(prog='make_sounds.py', description=__doc__.split('\n')[1])
    p.add_argument('raw', nargs='+', help='raw source files and/or folders')
    p.add_argument('--out', default=os.path.normpath(os.path.join(here, '..', 'assets', 'sounds')))
    p.add_argument('--only', default='', help='comma-separated output names')
    p.add_argument('--keep-temp', action='store_true')
    return p.parse_args(argv)


def find_sources(raw_paths):
    """Map file name -> absolute path for every file under the given paths."""
    found = {}
    for r in raw_paths:
        r = os.path.abspath(r)
        if os.path.isfile(r):
            found.setdefault(os.path.basename(r), r)
        elif os.path.isdir(r):
            for root, _dirs, files in os.walk(r):
                for f in sorted(files):
                    found.setdefault(f, os.path.join(root, f))
        else:
            print('WARNING: raw path not found:', r)
    return found


def decode(path, tmpdir):
    """Decode a source to mono 32-bit PCM WAV at its native rate (-6 dB headroom)."""
    snd = aud.Sound(path)
    rate = int(round(snd.specs[0]))
    x = np.asarray(snd.data(), dtype=np.float64)
    if x.ndim == 2:
        x = x.mean(axis=1)
    x = x * 0.5
    wav = os.path.join(tmpdir, os.path.splitext(os.path.basename(path))[0] + '.wav')
    pcm = np.clip(np.round(x * 2147483647.0), -2147483648, 2147483647).astype('<i4')
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(4)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return wav, x, rate


def read_wav(path, nsamples=None):
    """Read a mono or multi-channel PCM WAV (16/24/32-bit) as float64 mono."""
    with wave.open(path, 'rb') as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, '<i2').astype(np.float64) / 32768.0
    elif sw == 4:
        x = np.frombuffer(raw, '<i4').astype(np.float64) / 2147483648.0
    elif sw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        x = np.where(v >= 1 << 23, v - (1 << 24), v).astype(np.float64) / 8388608.0
    else:
        raise ValueError('unsupported sample width %d' % sw)
    x = x.reshape(-1, ch).mean(axis=1)
    # Blender's WAV writer can append a few hundred samples past the requested
    # range, so callers pass the expected length.
    return (x[:nsamples] if nsamples else x), rate


def fresh_scene():
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.render.fps_base = 1.0
    se = sc.sequence_editor or sc.sequence_editor_create()
    for s in list(se.strips):
        se.strips.remove(s)
    sc.animation_data_clear()
    return sc, se


def add_strip(se, wav, name, channel, src_ms, at, length):
    """Sound strip that plays wav from src_ms (ms into the file) on frames [at, at+length)."""
    s = se.strips.new_sound(name, wav, channel, at - src_ms)
    s.left_handle = at
    s.right_handle = at + length
    return s


def key_volume(strip, points):
    for frame, vol in points:
        strip.volume = vol
        strip.keyframe_insert('volume', frame=frame)


def curve(f0, f1, fn):
    """Keyframes from f0 to f1 (inclusive) every CURVE_STEP frames; fn maps 0..1 -> volume."""
    frames = list(range(f0, f1, CURVE_STEP)) + [f1]
    span = max(1, f1 - f0)
    return [(f, fn((f - f0) / span)) for f in frames]


def mixdown(path, rate, container, codec, fmt):
    if os.path.exists(path):
        os.remove(path)
    res = bpy.ops.sound.mixdown(filepath=path, check_existing=False, relative_path=False,
                                container=container, codec=codec, format=fmt,
                                bitrate=BITRATE, mixrate=rate, channels='MONO')
    if 'FINISHED' not in res or not os.path.exists(path):
        raise RuntimeError('mixdown failed for %s: %s' % (path, res))


# ---------------------------------------------------------------- cut finding

def plan_oneshot(c, x, rate):
    s0, s1 = c['search']
    end = c['end']
    seg = x[int(s0 * rate):int(end * rate)]
    blk = int(rate / 1000)
    nb = len(seg) // blk
    peaks = np.abs(seg[:nb * blk]).reshape(nb, blk).max(axis=1)
    thr = peaks.max() * 10 ** (-ONSET_DB / 20)
    first = int(np.argmax(peaks > thr))                    # ms after s0
    onset = s0 + first / 1000.0
    if onset > s1:
        print('WARNING: %s onset %.3f s is outside the search window' % (c['out'], onset))
    start_ms = max(int(round(s0 * 1000)), int(round(onset * 1000 - LEAD_S * 1000)))
    end_ms = int(round(end * 1000))
    return dict(start_ms=start_ms, len_ms=end_ms - start_ms, onset=round(onset, 3))


def plan_loop(c, x, rate):
    lp = c['loop']
    if rate == 48000:
        # whole MP3 frames: 1152 samples = 24 ms exactly
        lengths = [n * MP3_FRAME * 1000 // rate
                   for n in range(math.ceil(lp['length'][0] * rate / MP3_FRAME),
                                  math.floor(lp['length'][1] * rate / MP3_FRAME) + 1)]
    else:
        print('WARNING: loop source is %d Hz; loop length is not a whole number of MP3 frames' % rate)
        lengths = list(range(int(lp['length'][0] * 1000), int(lp['length'][1] * 1000) + 1, 10))
    x_ms = int(round(lp['xfade'] * 1000))
    xs = x_ms * rate // 1000
    best = (-2.0, None, None)
    for a_ms in range(int(lp['start'][0] * 1000), int(lp['start'][1] * 1000) + 1):
        a = a_ms * rate // 1000
        ref = x[a:a + xs]
        rn = math.sqrt(float(np.dot(ref, ref))) + 1e-12
        for l_ms in lengths:
            b = (a_ms + l_ms) * rate // 1000
            cand = x[b:b + xs]
            if len(cand) < xs:
                continue
            corr = float(np.dot(ref, cand)) / (rn * (math.sqrt(float(np.dot(cand, cand))) + 1e-12))
            if corr > best[0]:
                best = (corr, a_ms, l_ms)
    corr, a_ms, l_ms = best
    return dict(start_ms=a_ms, len_ms=l_ms, xfade_ms=x_ms, xfade_corr=round(corr, 3))


# ---------------------------------------------------------------- scene builds

def build(c, gain):
    sc, se = fresh_scene()
    p = c['_plan']
    n = p['len_ms']
    if 'loop' in c:
        X = p['xfade_ms']
        body = add_strip(se, c['_wav'], 'body', 1, p['start_ms'], 0, n)
        after = add_strip(se, c['_wav'], 'after_end', 2, p['start_ms'] + n, 0, X)
        key_volume(body, curve(0, X, lambda t: gain * math.sin(math.pi / 2 * t)))
        key_volume(after, curve(0, X, lambda t: gain * math.cos(math.pi / 2 * t)))
    else:
        fi = max(1, int(round(FADE_IN_S * FPS)))
        fo = int(round(c['fade_out'] * FPS))
        s = add_strip(se, c['_wav'], 'clip', 1, p['start_ms'], 0, n)
        key_volume(s, [(0, 0.0), (fi, gain)])
        key_volume(s, curve(n - 1 - fo, n - 1, lambda t: gain * math.cos(math.pi / 2 * t)))
    sc.frame_start = 0
    sc.frame_end = n - 1
    return n


def measure_peak_db(c, gain, tmpdir):
    n = build(c, gain)
    wav = os.path.join(tmpdir, 'measure.wav')
    mixdown(wav, c['_rate'], 'WAV', 'PCM', 'S32')
    y, _ = read_wav(wav, n * c['_rate'] // 1000)
    return db(np.abs(y).max())


def verify(path, tmpdir):
    """Decode the MP3 with aud and mix it back through a sound strip to WAV."""
    snd = aud.Sound(path)
    rate = int(round(snd.specs[0]))
    y = np.asarray(snd.data(), dtype=np.float64)
    y = y.mean(axis=1) if y.ndim == 2 else y
    sc, se = fresh_scene()
    s = se.strips.new_sound('check', path, 1, 0)
    s.volume = 0.5                                   # headroom for MP3 overshoot
    frames = s.duration
    sc.frame_start = 0
    sc.frame_end = frames - 1
    wav = os.path.join(tmpdir, 'check.wav')
    mixdown(wav, rate, 'WAV', 'PCM', 'S32')
    z, _ = read_wav(wav, frames * rate // 1000)
    return dict(samples=len(y), rate=rate, dur_s=round(len(y) / rate, 4),
                peak_db=round(db(np.abs(y).max()), 2),
                strip_frames=frames,
                mixback_peak_db=round(db(np.abs(z).max() * 2.0), 2))


# ---------------------------------------------------------------- credits

def print_credits(clips):
    # CREDITS.md also credits sounds this script doesn't make (the car's engine, crashes, screech and grind, under other
    # licenses), so it is edited by hand: paste these lines into it rather than overwrite it
    print('Credit lines for src/assets/sounds/CREDITS.md:')
    for c in clips:
        extra = ('; ' + c['note']) if c.get('note') else ''
        print('- `%s`: "%s", %s, by %s. License: %s. Trimmed, normalized, converted to MP3%s.'
              % (c['out'], c['title'], c['url'], c['author'], c['license'], extra))


# ---------------------------------------------------------------- main

def main():
    args = parse_args()
    only = set(n.strip() for n in args.only.split(',') if n.strip())
    clips = [c for c in CLIPS if not only or c['out'] in only]
    sources = find_sources(args.raw)
    missing = [c['src'] for c in clips if c['src'] not in sources]
    if missing:
        raise SystemExit('missing raw sources: ' + ', '.join(missing))

    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    os.makedirs(args.out, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix='make_sounds_')
    rows = []
    try:
        decoded = {}
        for c in clips:
            if c['src'] not in decoded:
                decoded[c['src']] = decode(sources[c['src']], tmpdir)
            c['_wav'], x, c['_rate'] = decoded[c['src']]
            if c['_rate'] not in (44100, 48000):
                raise SystemExit('%s: unexpected source rate %d' % (c['src'], c['_rate']))
            c['_plan'] = plan_loop(c, x, c['_rate']) if 'loop' in c else plan_oneshot(c, x, c['_rate'])

            peak_half = measure_peak_db(c, 0.5, tmpdir)
            gain = 0.5 * 10 ** ((TARGET_DB - peak_half) / 20)
            out = os.path.join(args.out, c['out'])
            for attempt in range(2):
                build(c, gain)
                mixdown(out, c['_rate'], 'MP3', 'MP3', 'S16')
                v = verify(out, tmpdir)
                if abs(v['peak_db'] - TARGET_DB) <= PEAK_TOL_DB or attempt:
                    break
                gain *= 10 ** ((TARGET_DB - v['peak_db']) / 20)
            row = dict(out=c['out'], src=c['src'], **c['_plan'],
                       gain_db=round(db(gain * 0.5), 2),  # vs. the decoded (mono) source
                       size=os.path.getsize(out), **v)
            rows.append(row)
            print('RESULT ' + json.dumps(row), flush=True)
        print_credits(clips)
    finally:
        if args.keep_temp:
            print('temp files kept in', tmpdir)
        else:
            shutil.rmtree(tmpdir, ignore_errors=True)

    print('\n%-16s %8s %7s %8s %9s %6s' % ('file', 'dur s', 'rate', 'bytes', 'peak dB', 'frames'))
    for r in rows:
        print('%-16s %8.3f %7d %8d %9.2f %6d' % (r['out'], r['dur_s'], r['rate'], r['size'],
                                                 r['peak_db'], r['strip_frames']))
    print('total bytes', sum(r['size'] for r in rows), flush=True)


main()
