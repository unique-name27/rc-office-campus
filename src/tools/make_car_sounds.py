"""make_car_sounds.py -- convert the WAVs of "FREE CAR SFX" by LMGLolo (https://lmglolo.itch.io/free-car-sfx,
CC BY-ND 4.0) into the MP3s the game plays.

The license allows no derivatives, so this is a format change only: every file keeps its full length, both channels
and its own levels (no trimming, no fades, no normalizing). Each is encoded as stereo 44.1 kHz 64 kbit/s MP3. The game
picks loop points, levels and pitch while it plays.

Run with Blender's Python (aud encodes MP3; no ffmpeg needed), then repack with src/tools/pack_sounds.py:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -t 4 --python src/tools/make_car_sounds.py -- "PATH/FREE CAR SFX Pack" src/assets/sounds

It prints one JSON line per file. For the "(Loop)" file, `n` (the length in samples at 44.1 kHz) goes into CAR_N in
src/js/game-1-core.js: the game loops exactly that much audio, so the loop stays seamless whether or not a browser's
MP3 decoder trims the encoder delay.
"""
import sys, os, json, wave
import aud

PACK, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
os.makedirs(OUT, exist_ok=True)
# the engine is a real recording instead (src/tools/make_engine_loops.py); from this pack: crashes, screeches, grind
FILES = {'car-grind': 'Grinding (Loop).wav'}
FILES.update({f'car-crash-{i}': f'Crash_Hard-00{i}.wav' for i in range(1, 5)})
FILES.update({f'car-screech-{i}': f'Tire_Screech-00{i}.wav' for i in range(1, 5)})

total = 0
for name, src in FILES.items():
    path = os.path.join(PACK, src)
    w = wave.open(path, 'rb'); n, sr, ch = w.getnframes(), w.getframerate(), w.getnchannels(); w.close()
    assert sr == 44100 and ch == 2, (src, sr, ch)
    out = os.path.join(OUT, name + '.mp3')
    aud.Sound(path).write(out, rate=sr, channels=aud.CHANNELS_STEREO, format=aud.FORMAT_S16, container=aud.CONTAINER_MP3, codec=aud.CODEC_MP3, bitrate=64000)
    dec = aud.Sound(out).data()
    kb = os.path.getsize(out) / 1024; total += kb
    print(json.dumps({'name': name, 'src': src, 'n': n, 'seconds': round(n / sr, 3), 'decoded_n': int(dec.shape[0]), 'kb': round(kb, 1)}))
print(json.dumps({'files': len(FILES), 'total_kb': round(total, 1)}))
