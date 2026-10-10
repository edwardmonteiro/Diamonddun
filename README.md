# Diamond Dash

Runner 2D minimalista para Android: corra por uma cordilheira de cristal sob a aurora, colete diamantes e sobreviva às armadilhas.

**Baixar:** [última versão (APK)](https://github.com/edwardmonteiro/diamonddun/releases/latest)

## Como jogar

| Toque | Ação |
|---|---|
| Metade esquerda | Pular — toque de novo no ar para **pulo duplo**; segurar = pulo mais alto |
| Metade direita | **Dash** — avanço rápido que quebra paredes de cristal e atravessa lasers (recarga de ~1 s) |

Armadilhas: espinhos de cristal, serras (no chão, suspensas e móveis), estalactites que despencam, lasers temporizados, paredes de cristal, plataformas que desmoronam e abismos. A velocidade e a densidade de armadilhas crescem com a distância. Diamantes em sequência sobem o tom do som (combo).

## Fases com IA

No menu, **✦ Fases com IA** abre o Estúdio de Fases: descreva a fase ("noite rosa, muitas serras, nada de laser") ou toque nos atalhos, e um modelo de linguagem rodando **no próprio celular, offline** desenha a fase.

- **Motor:** llama.cpp compilado para ARM dentro do APK (multi-thread). Modelos Qwen2.5 Instruct (Apache-2.0): **1.5B** (≈1,1 GB, melhor) ou **0.5B** (≈470 MB, leve), baixados uma vez pelo app.
- **Cristal DS (design system de fases):** tokens de tema (aurora, rosa, gelo, ouro, esmeralda, abismo), catálogo de 13 peças (`src/ds/components.js`) e regras de jogabilidade (`src/ds/rules.js`). A IA só escolhe *quais* peças, em que ordem, tema, velocidade e diamantes — com saída travada por gramática (`src/ds/grammar.js`). O design system cuida de distâncias, ritmo, recarga do dash e garante o que o jogador pediu ou vetou.
- **Próxima fase:** o resultado da tentativa (concluiu? onde morreu?) volta para a IA, que ajusta a próxima.
- **Sem modelo?** O *gerador rápido* (determinístico, instantâneo) entende os mesmos pedidos.

## Tecnologia

- **Engine:** [Phaser 3](https://phaser.io) (open source, MIT) + Vite
- **Empacotamento Android:** Capacitor 7 (WebView, tela cheia imersiva, paisagem)
- **Arte e áudio 100% originais e procedurais:** `tools/gen_art.py` (fundo em 5 camadas com parallax), `tools/gen_sprites.py` (sprites) e `tools/gen_audio.py` (trilha sintetizada + efeitos). Para regenerar: `python3 tools/gen_*.py` (numpy, scipy, Pillow, ffmpeg)

## Desenvolvimento

```bash
npm install
npm run dev          # jogar no navegador (teclas: Espaço = pular, Shift/→ = dash, Esc = pausa)
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
```

O GitHub Actions compila e publica o APK em *Releases* a cada push na `main`.

### Assinatura

O APK é assinado com `android/app/diamond-dash.keystore` (chave dedicada a sideload, para que atualizações instalem por cima). Para publicar na Play Store, use uma chave privada via secrets do repositório: `DD_KEYSTORE_BASE64`, `DD_KEYSTORE_PASSWORD`, `DD_KEY_ALIAS`, `DD_KEY_PASSWORD`.
