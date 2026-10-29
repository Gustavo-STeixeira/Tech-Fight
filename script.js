// ===== Configuração =====
const W = 384, H = 216, CHAO = 192;   // resolução pequena = visual pixel art
const canvas = document.getElementById("jogo");
const ctx = canvas.getContext("2d");
const el = (id) => document.getElementById(id);
const elPainel = el("painel"), elTitulo = el("painel-titulo"), elTexto = el("painel-texto");
const elBtn = el("btn-iniciar"), elAnuncio = el("anuncio"), elTempo = el("tempo"), elPontos = el("pontos");

// ===== Lutadores =====
function criar(nome, paleta, forca) {
  return { nome, paleta, forca, x: 0, y: CHAO, vx: 0, vy: 0, hp: 100, estado: "idle", tempo: 0,
           impacto: 0, dir: 1, noChao: true, bloqueando: false, vitorias: 0, t: 0 };
}
const dev = criar("DEV", { pele: "#f2b987", cabelo: "#2b1a12", faixa: "#f28c28", camisa: "#1f5fa8",
  calca: "#0b2a4a", sapato: "#ffffff", luva: "#f28c28", olho: "#111", antena: false }, 1);
const bug = criar("BUG", { pele: "#4ade80", cabelo: "#14532d", faixa: null, camisa: "#7f1d1d",
  calca: "#1f2937", sapato: "#facc15", luva: "#4ade80", olho: "#ef4444", antena: true }, 0.8);

// ===== Estado do jogo =====
let fase = "titulo";   // titulo, intro, luta, fimRound, fim
let contador = 0, quadros = 0, quadrosTempo = 0, tempo = 60, rodada = 1, pontos = 0, tremor = 0;
let sparks = [], audio = null;
const entrada = { esq: false, dir: false, pular: false, defender: false, soco: false, chute: false };
const SEGURA = ["esq", "dir", "defender"];     // teclas que ficam ativas enquanto pressionadas
const ia = { espera: 0, modo: "" };

// ===== Som (bips de arcade) =====
function bip(freq, dur) {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = "square"; o.frequency.value = freq; g.gain.value = 0.04;
  o.connect(g); g.connect(audio.destination);
  o.start(); o.stop(audio.currentTime + dur);
}

// ===== Lógica de luta =====
function resetar(f, x, dir) {
  Object.assign(f, { x, y: CHAO, vx: 0, vy: 0, hp: 100, estado: "idle", tempo: 0, dir, noChao: true, bloqueando: false });
}
const atacando = (f) => f.estado === "soco" || f.estado === "chute";

function atacar(f, tipo, duracao, impacto) {
  f.estado = tipo; f.tempo = duracao; f.impacto = impacto; f.vx = 0;
  bip(tipo === "soco" ? 300 : 220, 0.05);
}

function golpear(f, o) {
  const soco = f.estado === "soco";
  const dx = (o.x - f.x) * f.dir;      // distância à frente do atacante
  if (o.estado === "ko" || dx <= 0 || dx > (soco ? 34 : 40) || Math.abs(o.y - f.y) > 22) return;
  const dano = Math.round((soco ? 8 : 12) * f.forca);
  const faisca = { x: o.x - f.dir * 4, y: o.y - 30, t: 0, cor: "#facc15" };

  if (o.bloqueando) {                   // defesa: só 1 de dano
    o.hp = Math.max(1, o.hp - 1); o.vx = f.dir * 1.5;
    faisca.cor = "#94a3b8"; bip(120, 0.06);
  } else {
    o.hp = Math.max(0, o.hp - dano);
    o.estado = "hit"; o.tempo = 14; o.vx = f.dir * 3.5; tremor = 5;
    bip(soco ? 520 : 400, 0.08);
    if (f === dev) pontos += dano * 10;
    if (o.hp <= 0) { o.estado = "ko"; o.vx = f.dir * 4; encerrarRound("K.O.!"); }
  }
  sparks.push(faisca);
}

// c = controle {mov, pular, defender, soco, chute}, igual para jogador e IA
function atualizar(f, c, o) {
  if (f.estado !== "ko" && f.estado !== "hit" && !atacando(f)) f.dir = o.x >= f.x ? 1 : -1;
  f.bloqueando = false;

  if (f.estado === "hit") {
    if (--f.tempo <= 0) f.estado = "idle";
    f.vx *= 0.85;
  } else if (f.estado === "ko") {
    f.vx *= 0.9;
  } else if (atacando(f)) {
    if (--f.tempo === f.impacto) golpear(f, o);
    if (f.tempo <= 0) f.estado = "idle";
  } else if (f.noChao && c.defender) {
    f.bloqueando = true; f.estado = "idle"; f.vx = 0;
  } else if (f.noChao && c.soco) atacar(f, "soco", 14, 6);
  else if (f.noChao && c.chute) atacar(f, "chute", 20, 9);
  else if (f.noChao) {
    f.vx = c.mov * 1.3;
    f.estado = c.mov ? "walk" : "idle";
    if (c.pular) { f.vy = -5.2; f.noChao = false; }
  }

  // Física
  f.x = Math.max(12, Math.min(W - 12, f.x + f.vx));
  f.vy += 0.3; f.y += f.vy;
  if (f.y >= CHAO) { f.y = CHAO; f.vy = 0; f.noChao = true; }
}

function controleJogador() {
  const c = { mov: (entrada.dir ? 1 : 0) - (entrada.esq ? 1 : 0), pular: entrada.pular,
              defender: entrada.defender, soco: entrada.soco, chute: entrada.chute };
  entrada.pular = entrada.soco = entrada.chute = false;   // golpes valem uma vez por toque
  return c;
}

function controleIA() {
  const c = { mov: 0, pular: false, defender: false, soco: false, chute: false };
  if (ia.espera > 0) {
    ia.espera--;
    if (ia.modo === "recuar") c.mov = -bug.dir;
    if (ia.modo === "defender") c.defender = true;
    return c;
  }
  const dist = Math.abs(dev.x - bug.x);
  if (dist > 40) {
    c.mov = bug.dir;                                  // aproxima do jogador
    if (Math.random() < 0.01) c.pular = true;
  } else if (atacando(dev) && Math.random() < 0.5) {
    ia.modo = "defender"; ia.espera = 20;
  } else if (Math.random() < 0.04) {
    if (Math.random() < 0.5) c.soco = true; else c.chute = true;
    ia.modo = "recuar"; ia.espera = 25 + Math.random() * 20;
  }
  return c;
}

function separar() {   // impede que os lutadores atravessem um ao outro
  const d = bug.x - dev.x;
  if (Math.abs(d) < 16 && dev.noChao && bug.noChao) {
    const s = (d >= 0 ? 1 : -1) * 1.5;
    dev.x -= s; bug.x += s;
  }
}

// ===== Fluxo de rounds =====
function mostrarAnuncio(texto) {
  elAnuncio.textContent = texto;
  elAnuncio.classList.remove("mostrar");
  void elAnuncio.offsetWidth;          // reinicia a animação CSS
  elAnuncio.classList.add("mostrar");
}

function iniciarRound() {
  resetar(dev, 100, 1); resetar(bug, W - 100, -1);
  tempo = 60; quadrosTempo = 0; sparks = []; ia.espera = 0;
  elTempo.textContent = tempo;
  fase = "intro"; contador = 110;
  mostrarAnuncio("ROUND " + rodada);
}

function iniciarJogo() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
  dev.vitorias = 0; bug.vitorias = 0; pontos = 0; rodada = 1;
  elPainel.hidden = true;
  iniciarRound();
}

function encerrarRound(motivo) {
  if (fase !== "luta") return;
  fase = "fimRound"; contador = 150;
  const venc = dev.hp > bug.hp ? dev : bug.hp > dev.hp ? bug : null;
  if (venc) { venc.vitorias++; if (venc === dev) pontos += 500 + tempo * 10; }
  mostrarAnuncio(venc ? motivo : "EMPATE");
  bip(venc === dev ? 880 : 150, 0.4);
}

function proximoRound() {
  if (dev.vitorias >= 2 || bug.vitorias >= 2) {
    fase = "fim";
    const venceu = dev.vitorias >= 2;
    elTitulo.textContent = venceu ? "VOCÊ VENCEU!" : "GAME OVER";
    elTexto.textContent = "Pontos: " + pontos;
    elBtn.textContent = "Jogar novamente";
    elPainel.hidden = false;
  } else {
    rodada++;
    iniciarRound();
  }
}

// ===== Passo de simulação (60 por segundo) =====
function passo() {
  quadros++; dev.t++; bug.t++;
  if (tremor > 0) tremor--;

  if (fase === "intro") {
    if (--contador === 55) { mostrarAnuncio("FIGHT!"); bip(660, 0.2); }
    if (contador <= 0) fase = "luta";
  } else if (fase === "luta") {
    atualizar(dev, controleJogador(), bug);
    atualizar(bug, controleIA(), dev);
    separar();
    if (++quadrosTempo >= 60) {
      quadrosTempo = 0; tempo--;
      elTempo.textContent = tempo;
      if (tempo <= 0) encerrarRound("TEMPO!");
    }
  } else if (fase === "fimRound") {
    const vazio = { mov: 0, pular: false, defender: false, soco: false, chute: false };
    atualizar(dev, vazio, bug); atualizar(bug, vazio, dev);
    if (--contador <= 0) proximoRound();
  }

  sparks.forEach((s) => s.t++);
  sparks = sparks.filter((s) => s.t < 12);
  atualizarHud();
}

function atualizarHud() {
  el("vida-dev").style.width = dev.hp + "%";
  el("vida-bug").style.width = bug.hp + "%";
  el("barra-dev").setAttribute("aria-valuenow", dev.hp);
  el("barra-bug").setAttribute("aria-valuenow", bug.hp);
  el("vit-dev").textContent = "★".repeat(dev.vitorias) + "☆".repeat(2 - dev.vitorias);
  el("vit-bug").textContent = "★".repeat(bug.vitorias) + "☆".repeat(2 - bug.vitorias);
  elPontos.textContent = pontos;
}

// ===== Cenário (desenhado uma vez em um canvas escondido) =====
const fundo = document.createElement("canvas");
fundo.width = W; fundo.height = H;
function criarFundo() {
  const g = fundo.getContext("2d");
  ["#1a0b3b", "#2d1066", "#4a1a8c", "#7b2a9c", "#b53a8c", "#e8587a"].forEach((c, i) => {
    g.fillStyle = c; g.fillRect(0, i * 26, W, 26);
  });
  g.fillStyle = "#ffd166"; g.beginPath(); g.arc(W / 2, 120, 36, 0, Math.PI * 2); g.fill();
  for (let x = 0, i = 0; x < W; i++) {                       // prédios com janelas
    const w = 22 + (i * 7) % 16, h = 40 + (i * 29) % 60;
    g.fillStyle = "#120a2e"; g.fillRect(x, 152 - h, w - 2, h);
    for (let jy = 0; jy < h - 6; jy += 8) for (let jx = 3; jx < w - 7; jx += 7) {
      g.fillStyle = (jx * 3 + jy * 5 + i) % 5 === 0 ? "#facc15" : "#2a1a55";
      g.fillRect(x + jx, 152 - h + 4 + jy, 3, 4);
    }
    x += w;
  }
  g.font = "bold 14px monospace"; g.textAlign = "center";   // letreiro neon
  g.shadowColor = "#22d3ee"; g.shadowBlur = 8; g.fillStyle = "#22d3ee";
  g.fillText("SENAC PRO", W / 2, 30); g.shadowBlur = 0;
  g.fillStyle = "#1b1b3a"; g.fillRect(0, 152, W, H - 152);   // chão em perspectiva
  g.strokeStyle = "#5b3fa8"; g.lineWidth = 1;
  for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(W / 2 + i * 8, 152); g.lineTo(W / 2 + i * 44, H); g.stroke(); }
  for (let k = 0; k < 6; k++) { const y = 152 + k * k * 2 + k * 4; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
}

// ===== Desenho =====
function desenharLutador(f) {
  const x = Math.round(f.x), y = Math.round(f.y), p = f.paleta;
  // r(): desenha um retângulo "à frente" (dx>0) ou "atrás" (dx<0) do lutador, respeitando a direção
  const r = (dx, dy, w, h, cor) => { ctx.fillStyle = cor; ctx.fillRect(f.dir > 0 ? x + dx : x - dx - w, y + dy, w, h); };
  ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(Math.round(f.x) - 11, CHAO, 22, 3);   // sombra

  if (f.estado === "ko") {            // caído no chão
    r(-24, -9, 11, 9, p.pele); r(-13, -10, 18, 10, p.camisa); r(5, -8, 18, 7, p.calca); r(21, -8, 4, 7, p.sapato);
    return;
  }
  const bob = f.estado === "idle" && f.noChao ? Math.round(Math.sin(f.t / 8)) : 0;
  const passo = f.estado === "walk" ? Math.round(Math.sin(f.t / 3) * 3) : 0;
  const rec = f.estado === "hit" ? -3 : 0;            // inclina para trás ao apanhar

  if (!f.noChao) { r(-6, -24, 6, 13, p.calca); r(1, -24, 6, 13, p.calca); r(-6, -12, 7, 3, p.sapato); r(1, -12, 7, 3, p.sapato); }
  else {
    r(-7 + passo, -16, 6, 16, p.calca); r(-8 + passo, -3, 8, 3, p.sapato);
    if (f.estado === "chute") { r(2, -27, 24, 7, p.calca); r(24, -28, 7, 9, p.sapato); }
    else { r(1 - passo, -16, 6, 16, p.calca); r(1 - passo, -3, 8, 3, p.sapato); }
  }
  r(-7 + rec, -32 + bob, 14, 16, p.camisa);
  r(-7 + rec, -18 + bob, 14, 2, p.luva);
  r(-5 + rec, -44 + bob, 10, 11, p.pele);
  r(-5 + rec, -45 + bob, 10, 3, p.cabelo);
  if (p.faixa) r(-6 + rec, -40 + bob, 12, 2, p.faixa);
  if (p.antena) { r(-3 + rec, -51 + bob, 2, 6, p.pele); r(2 + rec, -51 + bob, 2, 6, p.pele); }
  r(2 + rec, -40 + bob, 3, 3, f.estado === "hit" ? "#fff" : p.olho);

  if (f.estado === "soco") { r(3, -31, 22, 5, p.pele); r(24, -32, 7, 7, p.luva); }
  else if (f.bloqueando) r(3, -43, 6, 17, p.luva);
  else { r(3, -30, 5, 8, p.pele); r(6, -35, 7, 7, p.luva); }
}

function desenhar() {
  ctx.save();
  if (tremor > 0) ctx.translate(Math.round((Math.random() - 0.5) * tremor), 0);
  ctx.drawImage(fundo, 0, 0);
  ctx.fillStyle = "#0a0620";                                   // plateia animada
  for (let i = 0; i < W; i += 10) {
    const b = Math.round(Math.sin(quadros / 9 + i) * 1.5);
    ctx.fillRect(i + 1, 141 + b, 5, 5); ctx.fillRect(i, 146 + b, 7, 7);
  }
  desenharLutador(bug); desenharLutador(dev);
  for (const s of sparks) {
    const k = s.t;
    ctx.fillStyle = s.cor;
    ctx.fillRect(s.x - 1, s.y - k, 3, 2 * k); ctx.fillRect(s.x - k, s.y - 1, 2 * k, 3);
  }
  ctx.restore();
}

// ===== Laço principal: passo fixo de 60 Hz =====
let ultimo = performance.now(), acumulado = 0;
function loop(agora) {
  acumulado += Math.min(100, agora - ultimo); ultimo = agora;
  while (acumulado >= 1000 / 60) { passo(); acumulado -= 1000 / 60; }
  desenhar();
  requestAnimationFrame(loop);
}

// ===== Eventos =====
const TECLAS = { ArrowLeft: "esq", ArrowRight: "dir", ArrowUp: "pular", ArrowDown: "defender", d: "defender", a: "soco", s: "chute" };
document.addEventListener("keydown", (e) => {
  const acao = TECLAS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!acao) return;
  e.preventDefault(); entrada[acao] = true;
});
document.addEventListener("keyup", (e) => {
  const acao = TECLAS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (acao && SEGURA.includes(acao)) entrada[acao] = false;
});
document.querySelectorAll("[data-acao]").forEach((btn) => {   // botões de toque
  const acao = btn.dataset.acao;
  btn.addEventListener("pointerdown", () => { entrada[acao] = true; });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    btn.addEventListener(ev, () => { if (SEGURA.includes(acao)) entrada[acao] = false; }));
});
elBtn.addEventListener("click", iniciarJogo);

// ===== Início =====
resetar(dev, 100, 1); resetar(bug, W - 100, -1);
criarFundo();
atualizarHud();
requestAnimationFrame(loop);
