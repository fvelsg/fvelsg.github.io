const WATCH_PAGE_URL = "https://www.youtube.com/watch?v=";
const PLAYER_API_URL = "https://www.youtube.com/youtubei/v1/player?key=";
const KNOWN_PUBLIC_INNERTUBE_API_KEYS = [
  "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8"
];
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const ANDROID_USER_AGENT =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US)";
const ANDROID_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: "20.10.38"
  }
};
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

let cachedInnertubeApiKey = "";
let cachedInnertubeApiKeyExpiresAt = 0;

export const internals = {
  decodeHtmlEntities,
  parseSrv3Transcript,
  parseYouTubeVideoId,
  pickCaptionTrack,
  buildSrt
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    const requestUrl = new URL(request.url);

    if (requestUrl.pathname === "/health") {
      return jsonResponse({ ok: true }, 200);
    }

    if (request.method !== "GET") {
      return jsonResponse(
        { ok: false, error: "Use apenas requisições GET para este endpoint." },
        405
      );
    }

    try {
      const videoInput =
        requestUrl.searchParams.get("videoId") ||
        requestUrl.searchParams.get("url") ||
        requestUrl.searchParams.get("video");
      const videoId = parseYouTubeVideoId(videoInput);

      if (!videoId) {
        return jsonResponse(
          {
            ok: false,
            error: "Forneça um videoId válido ou uma URL válida do YouTube."
          },
          400
        );
      }

      const preferredLanguages = parsePreferredLanguages(
        requestUrl.searchParams.get("langs"),
        requestUrl.searchParams.get("lang")
      );
      const translateTo = normalizeLanguageCode(
        requestUrl.searchParams.get("translateTo")
      );
      const captionsRenderer = await fetchCaptionsRenderer(videoId);
      const selectedTrack = pickCaptionTrack(captionsRenderer, preferredLanguages);

      if (!selectedTrack) {
        return jsonResponse(
          {
            ok: false,
            error: "Este vídeo não possui legendas disponíveis."
          },
          404
        );
      }

      const srv3Xml = await fetchCaptionTrackXml(selectedTrack, translateTo);
      const snippets = parseSrv3Transcript(srv3Xml);

      if (!snippets.length) {
        return jsonResponse(
          {
            ok: false,
            error: "O YouTube retornou uma transcrição vazia para este vídeo."
          },
          404
        );
      }

      const srt = buildSrt(snippets);

      return jsonResponse({
        ok: true,
        videoId,
        track: {
          languageCode: selectedTrack.languageCode,
          languageName: getTrackDisplayName(selectedTrack),
          isGenerated: selectedTrack.kind === "asr"
        },
        availableTracks: (captionsRenderer.captionTracks || []).map(track => ({
          languageCode: track.languageCode,
          languageName: getTrackDisplayName(track),
          isGenerated: track.kind === "asr"
        })),
        srt
      });
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Erro inesperado ao buscar a transcrição."
        },
        500
      );
    }
  }
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "public, max-age=300"
    }
  });
}

async function fetchCaptionsRenderer(videoId) {
  const candidateKeys = [];
  const triedKeys = new Set();
  let lastError = null;

  if (cachedInnertubeApiKey && Date.now() < cachedInnertubeApiKeyExpiresAt) {
    candidateKeys.push(cachedInnertubeApiKey);
  }

  for (const apiKey of KNOWN_PUBLIC_INNERTUBE_API_KEYS) {
    if (!candidateKeys.includes(apiKey)) {
      candidateKeys.push(apiKey);
    }
  }

  for (const apiKey of candidateKeys) {
    triedKeys.add(apiKey);

    try {
      const captionsRenderer = await fetchCaptionsRendererWithApiKey(videoId, apiKey);
      cachedInnertubeApiKey = apiKey;
      cachedInnertubeApiKeyExpiresAt = Date.now() + 30 * 60 * 1000;
      return captionsRenderer;
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const runtimeApiKey = await getInnertubeApiKey(videoId);

    if (!triedKeys.has(runtimeApiKey)) {
      const captionsRenderer = await fetchCaptionsRendererWithApiKey(videoId, runtimeApiKey);
      cachedInnertubeApiKey = runtimeApiKey;
      cachedInnertubeApiKeyExpiresAt = Date.now() + 30 * 60 * 1000;
      return captionsRenderer;
    }
  } catch (error) {
    lastError = error;
  }

  throw lastError || new Error("Não foi possível consultar as legendas deste vídeo.");
}

async function fetchCaptionsRendererWithApiKey(videoId, apiKey) {
  const response = await fetch(PLAYER_API_URL + apiKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ANDROID_USER_AGENT,
      "X-YouTube-Client-Name": "3",
      "X-YouTube-Client-Version": ANDROID_CONTEXT.client.clientVersion,
      Origin: "https://www.youtube.com"
    },
    body: JSON.stringify({
      context: ANDROID_CONTEXT,
      videoId
    })
  });

  if (!response.ok) {
    throw new Error(`Falha ao consultar o player do YouTube (${response.status}).`);
  }

  const playerData = await response.json();
  const playabilityStatus = playerData?.playabilityStatus?.status;

  if (playabilityStatus && playabilityStatus !== "OK") {
    const reason =
      playerData?.playabilityStatus?.reason ||
      "O YouTube não liberou a reprodução deste vídeo.";
    throw new Error(reason);
  }

  const captionsRenderer =
    playerData?.captions?.playerCaptionsTracklistRenderer;

  if (!captionsRenderer?.captionTracks?.length) {
    throw new Error("Este vídeo não possui legendas disponíveis.");
  }

  return captionsRenderer;
}

async function getInnertubeApiKey(videoId) {
  if (cachedInnertubeApiKey && Date.now() < cachedInnertubeApiKeyExpiresAt) {
    return cachedInnertubeApiKey;
  }

  let html = await fetchWatchHtml(videoId);

  if (html.includes('action="https://consent.youtube.com/s"')) {
    const consentMatch = html.match(/name="v" value="(.*?)"/);

    if (!consentMatch?.[1]) {
      throw new Error("Não foi possível criar o cookie de consentimento do YouTube.");
    }

    html = await fetchWatchHtml(videoId, `CONSENT=YES+${consentMatch[1]}`);
  }

  const apiKeyMatch =
    html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) ||
    html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/);

  if (!apiKeyMatch?.[1]) {
    throw new Error("Não foi possível localizar a chave pública do player do YouTube.");
  }

  cachedInnertubeApiKey = apiKeyMatch[1];
  cachedInnertubeApiKeyExpiresAt = Date.now() + 30 * 60 * 1000;
  return cachedInnertubeApiKey;
}

async function fetchWatchHtml(videoId, cookie = "") {
  const response = await fetch(WATCH_PAGE_URL + videoId, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: cookie,
      "User-Agent": BROWSER_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Falha ao abrir a página do vídeo no YouTube (${response.status}).`);
  }

  return response.text();
}

async function fetchCaptionTrackXml(track, translateTo = "") {
  const transcriptUrl = new URL(track.baseUrl);
  transcriptUrl.searchParams.set("fmt", "srv3");

  if (translateTo && track.isTranslatable) {
    transcriptUrl.searchParams.set("tlang", translateTo);
  }

  const response = await fetch(transcriptUrl.toString(), {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": ANDROID_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar a faixa de legenda (${response.status}).`);
  }

  return response.text();
}

function pickCaptionTrack(captionsRenderer, preferredLanguages = []) {
  const tracks = captionsRenderer.captionTracks || [];
  if (!tracks.length) {
    return null;
  }

  const manualTracks = tracks.filter(track => track.kind !== "asr");
  const generatedTracks = tracks.filter(track => track.kind === "asr");

  for (const languageCode of preferredLanguages) {
    const exactManual = manualTracks.find(track =>
      languageMatches(track.languageCode, languageCode, true)
    );
    if (exactManual) return exactManual;

    const exactGenerated = generatedTracks.find(track =>
      languageMatches(track.languageCode, languageCode, true)
    );
    if (exactGenerated) return exactGenerated;

    const looseManual = manualTracks.find(track =>
      languageMatches(track.languageCode, languageCode)
    );
    if (looseManual) return looseManual;

    const looseGenerated = generatedTracks.find(track =>
      languageMatches(track.languageCode, languageCode)
    );
    if (looseGenerated) return looseGenerated;
  }

  const defaultTrackIndex = captionsRenderer.audioTracks?.find(audioTrack =>
    Number.isInteger(audioTrack.defaultCaptionTrackIndex)
  )?.defaultCaptionTrackIndex;

  if (Number.isInteger(defaultTrackIndex) && tracks[defaultTrackIndex]) {
    return tracks[defaultTrackIndex];
  }

  return manualTracks[0] || generatedTracks[0] || tracks[0] || null;
}

function languageMatches(trackLanguage, preferredLanguage, exactOnly = false) {
  const normalizedTrack = normalizeLanguageCode(trackLanguage);
  const normalizedPreferred = normalizeLanguageCode(preferredLanguage);

  if (!normalizedTrack || !normalizedPreferred) {
    return false;
  }

  if (normalizedTrack === normalizedPreferred) {
    return true;
  }

  if (exactOnly) {
    return false;
  }

  return normalizedTrack.split("-")[0] === normalizedPreferred.split("-")[0];
}

function parsePreferredLanguages(langs, lang) {
  const values = [];

  if (lang) values.push(lang);
  if (langs) {
    values.push(
      ...langs
        .split(",")
        .map(value => value.trim())
        .filter(Boolean)
    );
  }

  const expanded = [];

  for (const value of values) {
    const normalized = normalizeLanguageCode(value);
    if (!normalized) continue;
    expanded.push(normalized);

    const baseLanguage = normalized.split("-")[0];
    if (baseLanguage && baseLanguage !== normalized) {
      expanded.push(baseLanguage);
    }
  }

  return [...new Set(expanded)];
}

function parseYouTubeVideoId(value) {
  const input = (value || "").trim();

  if (VIDEO_ID_PATTERN.test(input)) {
    return input;
  }

  try {
    const parsedUrl = new URL(input);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      const shortId = parsedUrl.pathname.split("/").filter(Boolean)[0];
      return VIDEO_ID_PATTERN.test(shortId || "") ? shortId : null;
    }

    if (["youtube.com", "m.youtube.com"].includes(hostname)) {
      const queryVideoId = parsedUrl.searchParams.get("v");
      if (VIDEO_ID_PATTERN.test(queryVideoId || "")) {
        return queryVideoId;
      }

      const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
      const candidateId = ["embed", "shorts", "live"].includes(pathParts[0])
        ? pathParts[1]
        : null;

      return VIDEO_ID_PATTERN.test(candidateId || "") ? candidateId : null;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function parseSrv3Transcript(xmlText) {
  const snippets = [];
  const paragraphRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;

  for (const match of xmlText.matchAll(paragraphRegex)) {
    const attributes = parseXmlAttributes(match[1]);
    const startMs = Number(attributes.t || 0);
    const durationMs = Number(attributes.d || 0);
    const text = normalizeCaptionText(extractParagraphText(match[2]));

    if (!text) {
      continue;
    }

    snippets.push({
      text,
      start: startMs / 1000,
      duration: durationMs / 1000
    });
  }

  return snippets;
}

function parseXmlAttributes(attributesText) {
  const attributes = {};

  for (const match of attributesText.matchAll(/(\w+)="([^"]*)"/g)) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function extractParagraphText(innerXml) {
  const syllableParts = [...innerXml.matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)].map(
    match => match[1]
  );
  const textSource = syllableParts.length ? syllableParts.join("") : innerXml;
  const withLineBreaks = textSource.replace(/<br\s*\/?>/gi, "\n");
  const withoutTags = withLineBreaks.replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withoutTags);
}

function normalizeCaptionText(text) {
  return text
    .replace(/\u200b/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeHtmlEntities(text) {
  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };

  return text
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) =>
      String.fromCodePoint(parseInt(value, 16))
    )
    .replace(/&([a-z]+);/gi, (match, entity) => namedEntities[entity] || match);
}

function buildSrt(snippets) {
  return snippets
    .map(
      (snippet, index) =>
        `${index + 1}\n${formatSrtTime(snippet.start)} --> ${formatSrtTime(
          snippet.start + snippet.duration
        )}\n${snippet.text}`
    )
    .join("\n\n");
}

function formatSrtTime(totalSeconds) {
  const totalMilliseconds = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, "0"))
    .join(":") + `,${String(milliseconds).padStart(3, "0")}`;
}

function getTrackDisplayName(track) {
  return (
    track?.name?.runs?.[0]?.text ||
    track?.name?.simpleText ||
    track?.languageCode ||
    "idioma desconhecido"
  );
}

function normalizeLanguageCode(value) {
  return (value || "").trim().toLowerCase().replace(/_/g, "-");
}

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
