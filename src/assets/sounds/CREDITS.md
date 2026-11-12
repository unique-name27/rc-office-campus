# Sound credits

The horn, barks and meows are real recordings released under CC0 1.0 (public
domain dedication), so attribution is not required. It is given here anyway.
Each was trimmed, normalized, converted to MP3 (mono, 64 kbit/s) by
`src/tools/make_sounds.py`.

The car's engine is a real CC0 recording of a Ford Escort (below). Its crashes,
tyre screech and wall grind come from "FREE CAR SFX" by LMGLolo (CC BY-ND 4.0,
see the end of this file).

- `car-engine-idle.mp3`, `car-engine-load.mp3`: "auto5.wav", https://freesound.org/people/escortmarius/sounds/141459/, by escortmarius (a 1985 Ford Escort Mk3 pulling away from a traffic light). License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Two steady stretches of its HQ preview (idling, and pulling under throttle) cut by `src/tools/make_engine_loops.py` into seamless loops of about 2.5 s, normalized, converted to MP3 (mono, 64 kbit/s).

- `car-horn.mp3`: "JM_TRANSPORT_EXT_Horn 01a - Car_Short_Mini Countryman.wav", https://freesound.org/people/Julien_Matthey/sounds/436589/, by Julien_Matthey. License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Trimmed, normalized, converted to MP3.
- `dog-bark-1.mp3`: "Single Dog Bark", https://freesound.org/people/kwahmah_02/sounds/277058/, by kwahmah_02. License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Trimmed, normalized, converted to MP3.
- `dog-bark-2.mp3`: "single bark - small to medium dog", https://freesound.org/people/haulaway/sounds/630648/, by haulaway. License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Trimmed, normalized, converted to MP3.
- `dog-bark-3.mp3`: "Dog bark 2", https://freesound.org/people/Sadiquecat/sounds/850823/, by Sadiquecat. License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Trimmed, normalized, converted to MP3.
- `cat-meow-1.mp3`: "Cat Meow", https://freesound.org/people/Mafon2/sounds/436541/, by Mafon2. License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Trimmed, normalized, converted to MP3.
- `cat-meow-2.mp3`: "2015-11-24.νιαούρισμα.Νιάου.noise reduced.flac", https://commons.wikimedia.org/wiki/File:2015-11-24.%CE%BD%CE%B9%CE%B1%CE%BF%CF%8D%CF%81%CE%B9%CF%83%CE%BC%CE%B1.%CE%9D%CE%B9%CE%AC%CE%BF%CF%85.noise_reduced.flac, by Tsester (Wikimedia Commons). License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Trimmed, normalized, converted to MP3.
- `cat-meow-3.mp3`: "Meow of a Siamese cat - freemaster2.wav", https://commons.wikimedia.org/wiki/File:Meow_of_a_Siamese_cat_-_freemaster2.wav, by freemaster2 (via Wikimedia Commons; originally Freesound sound 66518). License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/). Trimmed, normalized, converted to MP3.

## Car sounds: "FREE CAR SFX" by LMGLolo

- Source: "FREE CAR SFX" by LMGLolo, https://lmglolo.itch.io/free-car-sfx
- License: CC BY-ND 4.0 (https://creativecommons.org/licenses/by-nd/4.0/). The author also asks: no reuploading the pack as your own, and credit "LMGLolo" if possible.
- Not modified. `src/tools/make_car_sounds.py` only converts the format (WAV 24-bit to MP3, stereo, 44.1 kHz, 64 kbit/s), which the license allows for other media and formats. Every file keeps its full length, both channels and its own levels. The game picks loop points, mix levels and pitch while it plays.

| File | Original |
|---|---|
| `car-crash-1.mp3` .. `car-crash-4.mp3` | "Crash_Hard-001.wav" .. "-004.wav" |
| `car-screech-1.mp3` .. `car-screech-4.mp3` | "Tire_Screech-001.wav" .. "-004.wav" |
| `car-grind.mp3` | "Grinding (Loop).wav" |
