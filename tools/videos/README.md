# Vídeo-aulas do APOLVEN (Suporte › treinamento)

25 aulas gravadas no próprio sistema (demonstração), com narração em voz feminina (Kokoro TTS, voz `pf_dora`, pt-BR)
e legenda na imagem. Cada fala tem o próprio áudio, aparece como legenda no instante em que é narrada e vai para o
`.vtt` (transcrição clicável na tela de Suporte). Saída em `frontend/public/treinamento/`:
`<aula>.mp4`, `<aula>.vtt`, `<aula>-capa.jpg` (abertura) e `<aula>.jpg` (miniatura). O índice
`frontend/src/lib/training.js` é gerado — não edite à mão.

## Regravar

Pré-requisitos: Postgres + API em 3334 (`cd backend && npm start`, sem `APOLVEN_TEST_ADAPTERS`), `cd frontend && npm run build`,
Node com `playwright` e `pg`, Python com `kokoro-onnx` e `soundfile`, `ffmpeg`, e o modelo Kokoro
(`kokoro-v1.0.onnx` e `voices-v1.0.bin` em `/home/claude/tts/` — ajuste o caminho em `tts_batch.py`).

```bash
sudo node proxy80.mjs &              # serve frontend/dist + /api em http://apolven.lorler.com.br (mapeado para 127.0.0.1)
node record.mjs texts                # falas → out/texts.json
python3 tts_batch.py                 # narração → out/tts (cache por conteúdo)
node record.mjs rec 1 2 3 --dry      # ensaio rápido com capturas em out/dry (sem áudio)
node record.mjs rec                  # grava todas (ou informe os números)
python3 compose.py                   # monta mp4 + vtt + capas em out/final
cp out/final/* ../../frontend/public/treinamento/ && node gen-training.mjs
```

Roteiro: `lessons.mjs` (passos com `act` = o que acontece na tela e `say` = falas/legendas). A aula 25 mostra a própria
tela de Suporte: grave-a depois das demais e do build do frontend.

## Aula 27 — API de cotação da seguradora (seguradora fictícia)

Usa a "Seguradora Exemplo S.A." (fictícia): `fake-seguradora-exemplo.mjs` serve o portal do desenvolvedor, o OAuth2
client credentials (`/oauth/token`) e a API no padrão APOLVEN em HTTPS. Só para a gravação:

```bash
# certificados de teste em out/tls (CA própria + servidor para *.seguradora-exemplo.com.br) e nome → 127.0.0.1
echo "127.0.0.1 api.seguradora-exemplo.com.br portal.seguradora-exemplo.com.br" >> /etc/hosts
TLS_CERT=out/tls/server.crt TLS_KEY=out/tls/server.key node fake-seguradora-exemplo.mjs 443 &
# API de gravação (porta 3334) com a CA de teste e APOLVEN_ALLOW_LOCAL_API=1 — nunca em produção
NODE_EXTRA_CA_CERTS=$PWD/out/tls/ca.crt APOLVEN_ALLOW_LOCAL_API=1 ... node ../../backend/src/server.js &
node record.mjs texts 27 && KOKORO_DIR=/caminho/dos/modelos python3 tts_batch.py
node record.mjs rec 27 && python3 compose.py --sync 27-api-de-cotacao-da-seguradora
```

Depois: remova a linha do `/etc/hosts` e pare a seguradora de teste e a API de gravação. `compose.py --sync` alinha voz e
legenda ao instante em que cada legenda aparece na imagem (útil quando a gravação "atrasa" em máquina carregada).
