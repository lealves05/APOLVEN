import sys, subprocess, re
from PIL import Image
for name in sys.argv[1:]:
    vtt = open(f'/home/claude/videokit-apolven/out/final/{name}.vtt', encoding='utf-8').read()
    starts = [re.match(r'(\d+):(\d+):([\d.]+)', l) for l in vtt.splitlines() if '-->' in l]
    ts = [int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) + 1.2 for m in starts]
    W, H, cols = 480, 300, 4
    im = Image.new('RGB', (W * cols, H * ((len(ts) + cols - 1) // cols)), 'white')
    for i, t in enumerate(ts):
        p = f'/tmp/claude-0/s{i}.png'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t:.2f}', '-i', f'/home/claude/videokit-apolven/out/final/{name}.mp4', '-frames:v', '1', '-vf', f'scale={W}:{H}', p], check=True)
        im.paste(Image.open(p), ((i % cols) * W, (i // cols) * H))
    im.save(f'/tmp/claude-0/sheet-{name[:2]}.png')
