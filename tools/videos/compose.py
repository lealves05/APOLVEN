"""Monta as vídeo-aulas: corta a gravação, posiciona cada fala no instante em que a legenda apareceu,
normaliza o áudio e gera .mp4 (H.264 + AAC), .vtt (mesmas falas), capa e miniatura.
Uso: python3 compose.py [arquivo ...]   (sem argumentos: todas as gravações em out/raw)"""
import json, os, subprocess, sys, glob

RAW, TTS, OUT = 'out/raw', 'out/tts', 'out/final'
os.makedirs(OUT, exist_ok=True)
durs = json.load(open(os.path.join(TTS, 'durations.json')))


def ts(s):
    s = max(0.0, s)
    h, r = divmod(s, 3600)
    m, r = divmod(r, 60)
    return f'{int(h):02d}:{int(m):02d}:{r:06.3f}'


def compose(name):
    tl = json.load(open(os.path.join(RAW, f'{name}.json')))
    src = os.path.join(RAW, f'{name}.webm')
    start, end = tl['start'], tl['end']
    length = end - start
    cues = [c for c in tl['cues'] if c['at'] >= start - 0.5]
    args = ['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{start:.3f}', '-i', src]
    flt = []
    for i, c in enumerate(cues):
        args += ['-i', os.path.join(TTS, f"{c['id']}.wav")]
        d = max(0, int((c['at'] - start) * 1000))
        flt.append(f'[{i + 1}:a]aresample=48000,adelay={d}|{d}[a{i}]')
    flt.append(''.join(f'[a{i}]' for i in range(len(cues))) + f'amix=inputs={len(cues)}:normalize=0:dropout_transition=0,'
               'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]')
    out = os.path.join(OUT, f'{name}.mp4')
    args += ['-filter_complex', ';'.join(flt), '-map', '0:v', '-map', '[aout]', '-r', '25',
             '-c:v', 'libx264', '-preset', 'medium', '-crf', '27', '-pix_fmt', 'yuv420p', '-tune', 'stillimage',
             '-c:a', 'aac', '-b:a', '80k', '-ac', '1', '-t', f'{length:.3f}', '-movflags', '+faststart', out]
    subprocess.run(args, check=True)
    # legendas / transcrição (WebVTT)
    lines = ['WEBVTT', '']
    for i, c in enumerate(cues):
        a = c['at'] - start
        b = a + durs[c['id']] + 0.25
        if i + 1 < len(cues):
            b = min(b, cues[i + 1]['at'] - start - 0.02)
        lines += [str(i + 1), f'{ts(a)} --> {ts(min(b, length))}', c['text'], '']
    open(os.path.join(OUT, f'{name}.vtt'), 'w', encoding='utf-8').write('\n'.join(lines))
    # capa (cartão de abertura) e miniatura (meio da aula)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '1.6', '-i', out, '-frames:v', '1', '-q:v', '4', os.path.join(OUT, f'{name}-capa.jpg')], check=True)
    mid = cues[len(cues) // 2]['at'] - start + 1.0 if len(cues) > 2 else length / 2
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{mid:.2f}', '-i', out, '-frames:v', '1', '-vf', 'scale=320:200', '-q:v', '5', os.path.join(OUT, f'{name}.jpg')], check=True)
    size = os.path.getsize(out) / 1e6
    print(f'{name}: {length:.0f}s, {len(cues)} falas, {size:.1f} MB')


names = sys.argv[1:] or sorted(os.path.basename(f)[:-5] for f in glob.glob(os.path.join(RAW, '*.json')))
for n in names:
    if os.path.exists(os.path.join(RAW, f'{n}.webm')):
        compose(n)
