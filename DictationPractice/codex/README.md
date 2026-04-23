# dictationpractice
A simple software to help practicing dictation with any language you want

The software is in Brazilian Portuguese, but I'll maybe translate it later to onther languages.

This is a simple webpage that allows you to open videos/audios and use transcription files (`.srt`) to practice dictation with them.

Now it supports two ways of working with YouTube videos:

- Manual mode: upload your own `.srt` or `.txt` file
- Automatic mode: load a YouTube URL and fetch the subtitles through a small Cloudflare Worker

The webpage itself still works as a static site on GitHub Pages. The only server-side part is the Cloudflare Worker used to fetch the captions from YouTube and return them to the frontend.

**STEPS FOR OFFLINE USE**
- Clone or download this repository
- Open the index.html file
- click on "Audio/Video"
- Select the kind of media "Audio" or "Video"
- Select the local video/audio file on "Escolher arquivo" and after that click on "Carregar Midia"
- Select the local transcription on "Escolher arquivo" and after that click on "Carregar Transcrição"
- The audio is going to start playing and it's only going to play the first part
- You just need to type what you hear in the field bellow and click to check "Verificar" or show the answer "Mostrar Resposta"
- If you want to go to the next part, click "Pŕoximo trecho" or if you want to go backwards click "Trecho anterior"
- Use `control` to repeat just the part you want as many times as you need to get the answer

**STEPS FOR GITHUB PAGES + AUTOMATIC YOUTUBE SUBTITLES**
- Deploy the Cloudflare Worker inside [`worker`](./worker)
- After deploy, copy the generated `*.workers.dev` URL
- Open [`config.js`](./config.js)
- Paste the worker URL in `subtitleWorkerUrl`
- Deploy the static files to GitHub Pages as usual
- Open the page, paste a YouTube URL, click `Carregar Vídeo`, and the page will try to load the subtitles automatically

The manual `.srt` upload still remains available as a fallback.

If you want to test it before downloading it, click here: https://fvelsg.github.io/DictationPractice/index.html
Suggested website to download the video transcriptions (always download the .srt file): https://downsub.com/
Or you can download the srt file using yt-dlp (https://github.com/yt-dlp/yt-dlp), I think that using downsub it much faster and easier though
