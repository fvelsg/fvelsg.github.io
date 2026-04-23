# Cloudflare Worker

Este worker busca a faixa de legendas de um video do YouTube e devolve a transcricao em `.srt` para a pagina estatica.

## Como publicar

1. Instale o Wrangler.
2. Entre nesta pasta:

```bash
cd worker
```

3. Se quiser, troque o nome do worker em `wrangler.toml`.
4. Publique:

```bash
npx wrangler deploy
```

5. Copie a URL gerada pelo Cloudflare, algo como:

```text
https://dictationpractice-subtitles.<seu-subdominio>.workers.dev
```

6. Abra o arquivo [`../config.js`](../config.js) e cole essa URL em `subtitleWorkerUrl`.

## Uso do endpoint

```text
GET /?videoId=VIDEO_ID&langs=pt-BR,en-US
```

Ou:

```text
GET /?url=https://www.youtube.com/watch?v=VIDEO_ID&langs=pt-BR,en-US
```

Resposta:

- `srt`: texto completo em formato `.srt`
- `track`: dados da faixa escolhida
- `availableTracks`: faixas encontradas no video
