// Utilitários e helpers
const $ = id => document.getElementById(id);
const converterTempoParaSegundos = tempo => {
  const [h, m, s] = tempo.split(":");
  const [segundos, milissegundos] = s.split(",");
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(segundos) + parseInt(milissegundos) / 1000;
};
const normalizarTexto = texto => texto.toLowerCase().replace(/[.,!?;:\-\[\](){}<>@#$%^&*_+=|\\/'"`~]/g, '').replace(/\s+/g, ' ').trim();
const updateFeedback = (message, type) => {
  const feedbackEl = $("feedback");
  feedbackEl.textContent = message;
  feedbackEl.style.color = {correct: "var(--correct-color)", incorrect: "var(--incorrect-color)", info: "var(--info-color)"}[type] || "var(--info-color)";
};

// Variáveis globais
let videoPlayer = null;
let transcricoes = [], indiceAtual = 0, player = null, timeoutId = null;
let audioPlayer = $("audioPlayer");
let reproduzindoVideoCompleto = false, contextOptionsVisible = false;
let listenerPausaNormal = null;
let videoId = "", tipoMedia = "youtube";
let shortcuts = {repeat: "Control", check: "", show: "", prev: "", next: "", playAll: "", context: ""};

// Tema
const setupTheme = () => {
  const themeToggle = $('theme-toggle');
  const isDark = localStorage.getItem('theme') === 'dark' || 
                (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeToggle.checked = true;
  }
  
  themeToggle.addEventListener('change', function() {
    document.documentElement[this.checked ? 'setAttribute' : 'removeAttribute']('data-theme', 'dark');
    localStorage.setItem('theme', this.checked ? 'dark' : 'light');
  });
};

// Gerenciamento de atalhos
const carregarAtalhosSalvos = () => {
  const atalhosSalvos = localStorage.getItem('transcricao_atalhos');
  if (atalhosSalvos) shortcuts = JSON.parse(atalhosSalvos);
  atualizarDisplayDeAtalhos();
};

const salvarAtalhos = () => {
  localStorage.setItem('transcricao_atalhos', JSON.stringify(shortcuts));
  atualizarDisplayDeAtalhos();
};

const atualizarDisplayDeAtalhos = () => {
  $('repeatShortcutDisplay').textContent = shortcuts.repeat || "Ctrl";
  
  ['repeat', 'check', 'show', 'prev', 'next', 'playAll', 'context'].forEach(key => {
    const el = $(`${key}Shortcut`);
    if (el) el.value = shortcuts[key] || "";
  });
};

// YouTube API
const loadYouTubeAPI = () => {
  const tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
};

window.onYouTubeIframeAPIReady = () => console.log("API do YouTube pronta");

const onPlayerStateChange = event => {
  if (event.data === YT.PlayerState.PLAYING && !reproduzindoVideoCompleto) {
    clearYoutubeTimeout();
    
    // Não configurar timeout se estiver reproduzindo com contexto
    if (window.ignorarPausaAutomatica) {
      return;
    }
    
    if (transcricoes.length > 0 && indiceAtual < transcricoes.length) {
      const trecho = transcricoes[indiceAtual];
      const duracaoMS = Math.max(0, (trecho.fim - player.getCurrentTime()) * 1000);
      
      timeoutId = setTimeout(() => {
        if (player && player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
      }, duracaoMS);
    }
  }
};

const clearYoutubeTimeout = () => {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
};

// UI de abas
const openTab = (evt, tabName) => {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
  
  $(tabName).classList.add("active");
  evt.currentTarget.classList.add("active");
  
  tipoMedia = tabName === "youtube-tab" ? "youtube" : "audio";
};

const updateFileName = (input, elementId) => {
  $(elementId).textContent = input.files.length > 0 ? input.files[0].name : "Nenhum arquivo selecionado";
};

// Carregamento de mídia
const carregarYouTube = () => {
  const url = $("youtubeUrl").value;
  const match = url.match(/^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/);
  
  if (match && match[7].length == 11) {
    videoId = match[7];
    
    $("player").style.display = "block";
    $("audioPlayer").style.display = "none";
    
    const playerHeight = window.innerWidth <= 480 ? '200' : window.innerWidth <= 768 ? '250' : '360';
    $("media-container").style.minHeight = window.innerWidth <= 768 ? playerHeight + "px" : "auto";
    
    if (player) {
      player.loadVideoById(videoId);
      player.pauseVideo();
    } else {
      player = new YT.Player('player', {
        height: playerHeight,
        width: '100%',
        videoId: videoId,
        playerVars: { 'playsinline': 1, 'controls': 1 },
        events: {
          'onReady': e => e.target.pauseVideo(),
          'onStateChange': onPlayerStateChange
        }
      });
    }
    
    tipoMedia = "youtube";
    updateFeedback("Vídeo do YouTube carregado! Agora carregue seu arquivo de transcrição.", "correct");
  } else {
    updateFeedback("URL do YouTube inválida. Por favor, insira uma URL válida.", "incorrect");
  }
};

const setupAudioPauseListener = () => {
  if (listenerPausaNormal) audioPlayer.removeEventListener("timeupdate", listenerPausaNormal);
  
  listenerPausaNormal = function() {
    if (!reproduzindoVideoCompleto && transcricoes.length > 0 && 
        indiceAtual < transcricoes.length && audioPlayer.currentTime >= transcricoes[indiceAtual].fim - 0.1) {
      audioPlayer.pause();
    }
  };

  audioPlayer.addEventListener("timeupdate", listenerPausaNormal);
};

const setupVideoPauseListener = () => {
  if (videoPlayer._listenerPausaNormal) {
    videoPlayer.removeEventListener("timeupdate", videoPlayer._listenerPausaNormal);
  }
  
  videoPlayer._listenerPausaNormal = function() {
    if (!reproduzindoVideoCompleto && transcricoes.length > 0 && 
        indiceAtual < transcricoes.length && videoPlayer.currentTime >= transcricoes[indiceAtual].fim - 0.1) {
      videoPlayer.pause();
    }
  };

  videoPlayer.addEventListener("timeupdate", videoPlayer._listenerPausaNormal);
};

const carregarMidiaLocal = () => {
  const tipoMidiaSelecionada = document.querySelector('input[name="localMediaType"]:checked').value;
  const fileInput = $("mediaFile");
  const urlInput = $("mediaUrl").value.trim();
  
  // Verificar se pelo menos uma fonte foi fornecida
  if (fileInput.files.length === 0 && !urlInput) {
    updateFeedback("Por favor, selecione um arquivo ou insira uma URL.", "incorrect");
    return;
  }

  // Esconder o player do YouTube
  $("player").style.display = "none";
  
  // Determinar a fonte do arquivo (local ou URL)
  let mediaSource = "";
  if (fileInput.files.length > 0) {
    mediaSource = URL.createObjectURL(fileInput.files[0]);
  } else if (urlInput) {
    mediaSource = urlInput;
  }

  if (tipoMidiaSelecionada === "audio") {
    // Configurar o player de áudio
    if (videoPlayer) {
      videoPlayer.style.display = "none";
    }
    
    audioPlayer.style.display = "block";
    audioPlayer.style.width = "100%";
    audioPlayer.style.height = "50px";
    $("media-container").style.minHeight = "70px";
    
    audioPlayer.src = mediaSource;
    audioPlayer.load();
    audioPlayer.pause();
    
    setupAudioPauseListener();
    updateFeedback("Áudio carregado! Agora carregue seu arquivo de transcrição.", "correct");
  } else {
    // Configurar o player de vídeo
    audioPlayer.style.display = "none";
    
    // Criar ou reutilizar o elemento de vídeo
    if (!videoPlayer) {
      videoPlayer = document.createElement("video");
      videoPlayer.id = "videoPlayer";
      videoPlayer.controls = true;
      videoPlayer.style.width = "100%";
      videoPlayer.style.maxHeight = "360px";
      $("media-container").appendChild(videoPlayer);
    }
    
    videoPlayer.style.display = "block";
    $("media-container").style.minHeight = window.innerWidth <= 480 ? "200px" : 
                                          window.innerWidth <= 768 ? "250px" : "360px";
    
    videoPlayer.src = mediaSource;
    videoPlayer.load();
    videoPlayer.pause();
    
    // Configurar listener de pausa para vídeo similar ao do áudio
    setupVideoPauseListener();
    updateFeedback("Vídeo carregado! Agora carregue seu arquivo de transcrição.", "correct");
  }
  
  tipoMedia = tipoMidiaSelecionada;
};

// Controles de reprodução e navegação
const reproduzirVideoCompleto = () => {
  reproduzindoVideoCompleto = true;
  
  if (tipoMedia === "youtube") {
    if (!player) {
      updateFeedback("Carregue um vídeo do YouTube primeiro.", "incorrect");
      return;
    }
    
    clearYoutubeTimeout();
    player.seekTo(0);
    player.playVideo();
  } else if (tipoMedia === "audio") {
    if (!audioPlayer.src) {
      updateFeedback("Carregue um arquivo de áudio primeiro.", "incorrect");
      return;
    }
    
    audioPlayer.currentTime = 0;
    audioPlayer.play();
  } else if (tipoMedia === "video") {
    if (!videoPlayer || !videoPlayer.src) {
      updateFeedback("Carregue um arquivo de vídeo primeiro.", "incorrect");
      return;
    }
    
    videoPlayer.currentTime = 0;
    videoPlayer.play();
  }
  
  updateFeedback("Reproduzindo mídia completa...", "info");
};

const repetirTrecho = () => {
  if (indiceAtual < transcricoes.length) {
    reproduzindoVideoCompleto = false;
    tocarTrecho(transcricoes[indiceAtual]);
  }
};

const trechoAnterior = () => {
  if (indiceAtual > 0) {
    indiceAtual--;
    $("userInput").value = "";
    $("feedback").textContent = "";
    reproduzindoVideoCompleto = false;
    atualizarContador();
    carregarTrechoAtual();
  } else {
    updateFeedback("Você já está no primeiro trecho!", "info");
  }
};

const proximoTrecho = () => {
  if (indiceAtual < transcricoes.length - 1) {
    indiceAtual++;
    $("userInput").value = "";
    $("feedback").textContent = "";
    reproduzindoVideoCompleto = false;
    atualizarContador();
    carregarTrechoAtual();
  } else {
    updateFeedback("Você chegou ao último trecho!", "info");
  }
};

// Verificação de resposta
const verificarResposta = () => {
  if (transcricoes.length === 0) {
    updateFeedback("Carregue um arquivo de transcrição primeiro.", "incorrect");
    return;
  }
  
  const respostaUsuario = normalizarTexto($("userInput").value);
  const correta = transcricoes[indiceAtual].textoNormalizado;
  const correctTextEl = $("correctText");

  if (respostaUsuario === correta) {
    updateFeedback("✅ Correto! Ótimo trabalho!", "correct");
    correctTextEl.textContent = transcricoes[indiceAtual].textoOriginal;
    correctTextEl.style.display = "block";
  } else {
    updateFeedback("❌ Algo não está certo. Tente de novo!", "incorrect");
    correctTextEl.style.display = "none";
  }
};

const mostrarErro = () => {
  if (transcricoes.length === 0) {
    updateFeedback("Carregue um arquivo de transcrição primeiro.", "incorrect");
    return;
  }
  
  updateFeedback("👉 A resposta correta é:\n\n" + transcricoes[indiceAtual].textoOriginal, "info");
};

// Gerenciamento de transcrição
const carregarTranscricaoArquivo = () => {
  const fileInput = $("transcricaoFile");
  if (fileInput.files.length === 0) {
    updateFeedback("Por favor, selecione um arquivo de transcrição primeiro.", "incorrect");
    return;
  }
  
  const reader = new FileReader();
  reader.onload = e => processarTranscricao(e.target.result);
  reader.readAsText(fileInput.files[0]);
};

const processarTranscricao = texto => {
  const blocos = texto.trim().split(/\n\s*\n/);

  transcricoes = blocos.map(bloco => {
    const linhas = bloco.trim().split('\n');
    const tempoLinha = linhas.find(l => l.includes('-->')) || "00:00:00,000 --> 00:00:00,000";
    const [tempoInicio, tempoFim] = tempoLinha.split('-->').map(t => converterTempoParaSegundos(t.trim()));
    
    let textoTranscricao = "";
    let comecouTexto = false;
    
    for (let i = 0; i < linhas.length; i++) {
      if (comecouTexto) {
        textoTranscricao += linhas[i] + "\n";
      } else if (linhas[i].includes('-->')) {
        comecouTexto = true;
      }
    }
    
    return {
      inicio: tempoInicio,
      fim: tempoFim,
      textoOriginal: textoTranscricao.trim(),
      textoNormalizado: normalizarTexto(textoTranscricao)
    };
  });

  indiceAtual = 0;
  atualizarContador();
  
  updateFeedback(`Transcrição carregada com ${transcricoes.length} trechos!`, "correct");
  
  if (transcricoes.length > 0) carregarTrechoAtual();
};

const atualizarContador = () => {
  $("contador").textContent = transcricoes.length > 0 ? 
    `Trecho: ${indiceAtual + 1} / ${transcricoes.length}` : 
    "Nenhuma transcrição carregada";
};

const carregarTrechoAtual = () => {
  if (transcricoes.length === 0) {
    updateFeedback("Carregue um arquivo de transcrição primeiro.", "incorrect");
    return;
  }

  if (indiceAtual >= transcricoes.length) {
    updateFeedback("Fim da transcrição!", "info");
    return;
  }

  reproduzindoVideoCompleto = false;
  atualizarContador();
  tocarTrecho(transcricoes[indiceAtual]);
};

const tocarTrecho = trecho => {
  reproduzindoVideoCompleto = false;
  
  if (tipoMedia === "youtube") {
    if (!player) {
      updateFeedback("Carregue um vídeo do YouTube primeiro.", "incorrect");
      return;
    }
    
    clearYoutubeTimeout();
    player.seekTo(trecho.inicio);
    player.playVideo();
    
    timeoutId = setTimeout(() => {
      if (player && player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
    }, (trecho.fim - trecho.inicio) * 1000);
  } else if (tipoMedia === "audio") {
    if (!audioPlayer.src) {
      updateFeedback("Carregue um arquivo de áudio primeiro.", "incorrect");
      return;
    }
    
    audioPlayer.currentTime = trecho.inicio;
    audioPlayer.play();
  } else if (tipoMedia === "video") {
    if (!videoPlayer || !videoPlayer.src) {
      updateFeedback("Carregue um arquivo de vídeo primeiro.", "incorrect");
      return;
    }
    
    videoPlayer.currentTime = trecho.inicio;
    videoPlayer.play();
  }
};

// Opções de contexto
const toggleContextOptions = () => {
  contextOptionsVisible = !contextOptionsVisible;
  $('contextOptions').style.display = contextOptionsVisible ? 'block' : 'none';
};

const updateContextValue = type => {
  $(`${type}Value`).textContent = $(`${type}Context`).value;
};

const ouvirContexto = () => {
  if (transcricoes.length === 0 || indiceAtual >= transcricoes.length) {
    updateFeedback("Nenhum trecho carregado para reproduzir com contexto.", "incorrect");
    return;
  }
  
  const trecho = transcricoes[indiceAtual];
  const segundosAntes = parseInt($('beforeContext').value);
  const segundosDepois = parseInt($('afterContext').value);
  
  const inicioComContexto = Math.max(0, trecho.inicio - segundosAntes);
  const fimComContexto = trecho.fim + segundosDepois;
  
  reproduzindoVideoCompleto = false;
  
  
  if (tipoMedia === "youtube") {
    if (!player) {
      updateFeedback("Carregue um vídeo do YouTube primeiro.", "incorrect");
      return;
    }
    
    clearYoutubeTimeout();
    
    // Remover qualquer manipulador de intervalo anterior
    if (window.ytContextInterval) {
      clearInterval(window.ytContextInterval);
      window.ytContextInterval = null;
    }
    
    // Definir a flag para não pausar automaticamente com o listener padrão
    window.ignorarPausaAutomatica = true;
    
    player.seekTo(inicioComContexto);
    player.playVideo();
    
    // Usar um intervalo para verificar continuamente o tempo atual
    window.ytContextInterval = setInterval(() => {
      if (player && player.getPlayerState() === YT.PlayerState.PLAYING) {
        const tempoAtual = player.getCurrentTime();
        
        // Verificação de debug pode ser removida na versão final
        console.log(`Tempo atual: ${tempoAtual}, Fim com contexto: ${fimComContexto}`);
        
        if (tempoAtual >= fimComContexto) {
          player.pauseVideo();
          clearInterval(window.ytContextInterval);
          window.ytContextInterval = null;
          window.ignorarPausaAutomatica = false;
        }
      } else if (player && player.getPlayerState() !== YT.PlayerState.PLAYING && 
                player.getPlayerState() !== YT.PlayerState.BUFFERING) {
        // Limpar o intervalo se o vídeo parou por outro motivo (não em buffer)
        clearInterval(window.ytContextInterval);
        window.ytContextInterval = null;
        window.ignorarPausaAutomatica = false;
      }
    }, 100); // Verificar a cada 100ms
    
  } else if (tipoMedia === "audio") {
    if (!audioPlayer.src) {
      updateFeedback("Carregue um arquivo de áudio primeiro.", "incorrect");
      return;
    }
    
    // Remover qualquer listener de pausa anterior
    if (listenerPausaNormal) {
      audioPlayer.removeEventListener('timeupdate', listenerPausaNormal);
    }
    
    // Remover qualquer listener de contexto anterior que possa existir
    if (audioPlayer._contextoListener) {
      audioPlayer.removeEventListener('timeupdate', audioPlayer._contextoListener);
      delete audioPlayer._contextoListener;
    }
    
    audioPlayer.currentTime = inicioComContexto;
    
    // Criar novo listener para o contexto
    const pausarNoFimDoContexto = function() {
      if (audioPlayer.currentTime >= fimComContexto) {
        audioPlayer.pause();
        audioPlayer.removeEventListener('timeupdate', pausarNoFimDoContexto);
        
        // Restaurar o listener original
        setupAudioPauseListener();
      }
    };
    
    // Armazenar referência ao listener para remoção futura
    audioPlayer._contextoListener = pausarNoFimDoContexto;
    audioPlayer.addEventListener('timeupdate', pausarNoFimDoContexto);
    audioPlayer.play();
  } else if (tipoMedia === "video") {
    if (!videoPlayer || !videoPlayer.src) {
      updateFeedback("Carregue um arquivo de vídeo primeiro.", "incorrect");
      return;
    }
    
    // Remover qualquer listener de pausa anterior
    if (videoPlayer._listenerPausaNormal) {
      videoPlayer.removeEventListener('timeupdate', videoPlayer._listenerPausaNormal);
    }
    
    // Remover qualquer listener de contexto anterior
    if (videoPlayer._contextoListener) {
      videoPlayer.removeEventListener('timeupdate', videoPlayer._contextoListener);
      delete videoPlayer._contextoListener;
    }
    
    videoPlayer.currentTime = inicioComContexto;
    
    // Criar novo listener para o contexto
    const pausarNoFimDoContexto = function() {
      if (videoPlayer.currentTime >= fimComContexto) {
        videoPlayer.pause();
        videoPlayer.removeEventListener('timeupdate', pausarNoFimDoContexto);
        
        // Restaurar o listener original
        setupVideoPauseListener();
      }
    };
    
    // Armazenar referência ao listener para remoção futura
    videoPlayer._contextoListener = pausarNoFimDoContexto;
    videoPlayer.addEventListener('timeupdate', pausarNoFimDoContexto);
    videoPlayer.play();
  }
  
  updateFeedback(`Reproduzindo trecho com ${segundosAntes}s antes e ${segundosDepois}s depois...`, "info");
};

// Sistema de atalhos de teclado
document.addEventListener('keydown', function(event) {
  // Ignorar se estiver em campo de entrada ou modal aberto
  if ((document.activeElement.tagName === 'INPUT' && 
      !document.activeElement.hasAttribute('data-action')) ||
      ($('configModal').style.display === 'block' && 
      !document.activeElement.hasAttribute('data-action'))) {
    return;
  }
  
  // Mapa de ações para funções
  const actionMap = {
    'repeat': repetirTrecho,
    'check': verificarResposta,
    'show': mostrarErro,
    'prev': trechoAnterior,
    'next': proximoTrecho,
    'playAll': reproduzirVideoCompleto,
    'context': ouvirContexto
  };
  
  // Verificar Control como atalho especial
  if ((event.key === shortcuts.repeat) || 
      (event.key === 'Control' && shortcuts.repeat === 'Control') || 
      (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && 
       (event.code === "ControlLeft" || event.code === "ControlRight") && 
       event.key === "Control" && shortcuts.repeat === 'Control')) {
    repetirTrecho();
    event.preventDefault();
    return;
  }
  
  // Verificar outros atalhos
  for (const [action, key] of Object.entries(shortcuts)) {
    if (event.key === key && key && action !== 'repeat') {
      actionMap[action]?.();
      event.preventDefault();
      break;
    }
  }
});

// Configuração de modais
const setupModalListeners = () => {
  const modal = $('configModal');
  
  $('configBtn').addEventListener('click', () => {
    modal.style.display = 'block';
    atualizarDisplayDeAtalhos();
  });
  
  document.querySelector('.close-button').addEventListener('click', () => modal.style.display = 'none');
  
  window.addEventListener('click', event => {
    if (event.target === modal) modal.style.display = 'none';
  });

  $('saveConfig').addEventListener('click', () => {
    salvarAtalhos();
    modal.style.display = 'none';
    updateFeedback("Configurações salvas com sucesso!", "correct");
  });

  $('resetAllConfig').addEventListener('click', () => {
    shortcuts = {
      repeat: "Control", check: "", show: "", 
      prev: "", next: "", playAll: "", context: ""
    };
    atualizarDisplayDeAtalhos();
  });
};

const setupShortcutConfig = () => {
  document.querySelectorAll('input[data-action]').forEach(input => {
    input.addEventListener('keydown', function(event) {
      event.preventDefault();
      
      if (['Tab', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
      
      const action = this.getAttribute('data-action');
      shortcuts[action] = event.key;
      this.value = event.key;
    });
  });

  document.querySelectorAll('.reset-btn').forEach(button => {
    button.addEventListener('click', function() {
      const input = $(this.getAttribute('data-for'));
      const action = input.getAttribute('data-action');
      const defaultValue = input.getAttribute('data-default') || '';
      
      shortcuts[action] = defaultValue;
      input.value = defaultValue;
    });
  });
};

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
  setupTheme();
  carregarAtalhosSalvos();
  loadYouTubeAPI();
  setupModalListeners();
  setupShortcutConfig();
  
  // Ajustar altura do player ao redimensionar
  window.addEventListener('resize', function() {
    if (player && tipoMedia === "youtube") {
      const height = window.innerWidth <= 480 ? 200 : window.innerWidth <= 768 ? 250 : 360;
      $("player").style.height = height + "px";
    }
  });
});