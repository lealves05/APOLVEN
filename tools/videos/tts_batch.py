"""Narração (voz feminina pt-BR, Kokoro pf_dora) para out/texts.json → out/tts/<id>.wav + durations.json (cache por conteúdo)."""
import sys, json, os, hashlib, re, soundfile as sf
from kokoro_onnx import Kokoro
items = json.load(open('out/texts.json', encoding='utf-8'))
out = 'out/tts'; os.makedirs(out, exist_ok=True)
cache = 'cache'; os.makedirs(cache, exist_ok=True)
# pronúncia: siglas e nomes
FIX = [(r'\bAPOLVEN\b', 'Apolvén'), (r'\bCPF\b', 'cê pê éfe'), (r'\bCNPJ\b', 'cê ene pê jota'), (r'\bSUSEP\b', 'Susép'), (r'\bCSV\b', 'cê ésse vê'),
       (r'\bOFX\b', 'ó éfe xis'), (r'\bPDF\b', 'pê dê éfe'), (r'\bLGPD\b', 'éle gê pê dê'), (r'\bQR\b', 'quiú ár'), (r'\bRG\b', 'érre gê'), (r'\bCNH\b', 'cê ene agá'),
       (r'\bAPI\b', 'a pê í'), (r'\bCRM\b', 'cê érre ême'), (r'\bRCF\b', 'érre cê éfe'), (r'\bWhatsApp\b', 'uótsápi'), (r'\bControl\b', 'Contról'), (r'\bK\b', 'cá')]
k = None; durs = {}
for it in items:
    text = it['text'].strip()
    for a, b in FIX: text = re.sub(a, b, text)
    h = hashlib.sha1(f"pf_dora|1.0|{text}".encode()).hexdigest()[:16]
    cp = os.path.join(cache, h + '.wav')
    if not os.path.exists(cp):
        if k is None: k = Kokoro('/home/claude/tts/kokoro-v1.0.onnx', '/home/claude/tts/voices-v1.0.bin')
        s, sr = k.create(text, voice='pf_dora', speed=1.0, lang='pt-br')
        sf.write(cp, s, sr)
    info = sf.info(cp)
    dst = os.path.join(out, it['id'] + '.wav')
    if os.path.lexists(dst): os.remove(dst)
    os.symlink(os.path.abspath(cp), dst)
    durs[it['id']] = info.frames / info.samplerate
json.dump(durs, open(os.path.join(out, 'durations.json'), 'w'), indent=1)
print(f"{len(items)} falas, {sum(durs.values()):.1f}s")
