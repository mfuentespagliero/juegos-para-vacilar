import { isFirebaseConfigured } from "./firebase-config.js";

const root = document.querySelector("#app");
const toastElement = document.querySelector("#toast");
const SESSION_KEY = "piramide-multijugador:room";

const model = {
  user: null,
  roomCode: "",
  room: null,
  privateHand: {},
  publicHands: {},
  busy: false,
  confirmStart: false,
  handPanel: false,
  handRevealed: false,
  claimPicker: false,
  demo: false
};

let stopRoom = null;
let stopHand = null;
let stopPresence = null;
let subscribedHandMode = "";
let toastTimer = null;
let firebaseService = null;
let api = null;

function humanizeFirebaseError(error) {
  if (firebaseService) return firebaseService.humanizeFirebaseError(error);
  return String(error?.message || "No se pudo completar la acción.");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function valuesOf(value) {
  return value ? Object.values(value) : [];
}

function players() {
  return valuesOf(model.room?.players).sort((left, right) => {
    if (left.role === "host") return -1;
    if (right.role === "host") return 1;
    return (left.joinedAt || 0) - (right.joinedAt || 0);
  });
}

function me() {
  return model.room?.players?.[model.user?.uid] || null;
}

function isHost() {
  return model.room?.hostUid === model.user?.uid;
}

function cardsOf(hand) {
  const cards = hand?.cards || hand || {};
  return valuesOf(cards).sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function cardMarkup(card, { compact = false, hidden = false } = {}) {
  if (hidden) {
    return `<span class="playing-card card-back ${compact ? "compact" : ""}" aria-label="Carta oculta"><i>◆</i></span>`;
  }
  const used = card.used ? "used" : "";
  return `<span class="playing-card ${card.color === "red" ? "red" : ""} ${used} ${compact ? "compact" : ""}" aria-label="${escapeHTML(card.value)} de ${escapeHTML(card.suit)}${card.used ? ", usada" : ""}">
    <b>${escapeHTML(card.value)}</b>
    <span>${escapeHTML(card.symbol)}</span>
    ${card.used ? "<em>Usada</em>" : ""}
  </span>`;
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove("show"), 2800);
}

function reportFirebaseError(context, error) {
  console.error(context, error);
  showToast(humanizeFirebaseError(error));
}

function setSession(code, name) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code, name }));
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function cleanupHandSubscription() {
  stopHand?.();
  stopHand = null;
  subscribedHandMode = "";
  model.privateHand = {};
  model.publicHands = {};
  model.handRevealed = false;
}

function cleanupRoomSubscriptions() {
  stopRoom?.();
  stopPresence?.();
  stopRoom = null;
  stopPresence = null;
  cleanupHandSubscription();
}

function leaveLocalRoom() {
  cleanupRoomSubscriptions();
  clearSession();
  Object.assign(model, {
    roomCode: "",
    room: null,
    privateHand: {},
    publicHands: {},
    confirmStart: false,
    handPanel: false,
    handRevealed: false,
    claimPicker: false
  });
  render();
}

function subscribeToHandVisibility() {
  if (model.demo || !model.room || model.room.status !== "playing") {
    cleanupHandSubscription();
    return;
  }
  const visibility = model.room.settings?.handVisibility || "private";
  if (subscribedHandMode === visibility) return;
  cleanupHandSubscription();
  subscribedHandMode = visibility;

  if (visibility === "private") {
    stopHand = firebaseService.subscribeToPrivateHand(
      model.roomCode,
      model.user.uid,
      hand => renderPrivateHandMode(hand),
      error => reportFirebaseError("Error al sincronizar la mano privada:", error)
    );
    return;
  }
  subscribeToPublicHands();
}

function subscribeToPublicHands() {
  if (model.room?.settings?.handVisibility !== "public") return;
  stopHand = firebaseService.subscribeToPublicHands(
    model.roomCode,
    hands => updateVisibleCardState(hands),
    error => reportFirebaseError("Error al sincronizar las manos públicas:", error)
  );
}

function renderPrivateHandMode(hand) {
  model.privateHand = hand || {};
  if (model.room?.settings?.handVisibility === "private") render();
}

function renderPublicHandsMode(hands) {
  model.publicHands = hands || {};
  if (model.room?.settings?.handVisibility === "public") render();
}

function updateVisibleCardState(hands) {
  renderPublicHandsMode(hands);
}

function subscribeRoomState(code) {
  cleanupRoomSubscriptions();
  model.roomCode = code;
  stopRoom = firebaseService.subscribeToRoom(code, room => {
    if (!room) {
      showToast("La sala se cerró.");
      leaveLocalRoom();
      return;
    }
    model.room = room;
    subscribeToHandVisibility();
    render();
  }, error => {
    reportFirebaseError("Error al sincronizar la sala:", error);
    leaveLocalRoom();
  });
  stopPresence = firebaseService.connectPresence(code, model.user.uid);
}

async function run(task) {
  if (model.demo) {
    showToast("Esta es una vista de demostración.");
    return;
  }
  if (model.busy) return;
  model.busy = true;
  render();
  try {
    await task();
  } catch (error) {
    reportFirebaseError("Error al ejecutar una operación online:", error);
  } finally {
    model.busy = false;
    render();
  }
}

function brandHeader(extra = "") {
  return `<header class="topbar">
    <div class="brand-lockup">
      <span class="brand-mark" aria-hidden="true"></span>
      <span><strong>Pirámide</strong><small>Multijugador online</small></span>
    </div>
    ${extra}
  </header>`;
}

function renderConfiguration() {
  root.innerHTML = `<section class="page center-page">
    ${brandHeader()}
    <article class="config-card panel">
      <span class="eyebrow">Configuración requerida</span>
      <h1>Conecta Firebase</h1>
      <p>La versión online está implementada, pero necesita las credenciales públicas de tu proyecto para conectarse.</p>
      <ol>
        <li>Crea una app web en Firebase.</li>
        <li>Activa Authentication anónima y Realtime Database.</li>
        <li>Copia la configuración en <code>js/firebase-config.js</code>.</li>
        <li>Despliega reglas y funciones con <code>npm run deploy</code>.</li>
      </ol>
      <p class="config-note">Puedes revisar la interfaz sin backend abriendo <code>?demo=lobby</code>, <code>?demo=private</code> o <code>?demo=public</code>.</p>
    </article>
  </section>`;
}

function renderHome() {
  root.innerHTML = `<section class="page home-page">
    ${brandHeader()}
    <div class="home-hero">
      <p class="eyebrow">La mesa ahora está conectada</p>
      <h1>Pirámide <span>online.</span></h1>
      <p>Crea una sala, invita al grupo y elige quién puede ver las cartas.</p>
    </div>

    <div class="home-grid">
      <form class="panel room-form" data-form="create-room">
        <span class="form-icon" aria-hidden="true">♛</span>
        <div><h2>Crear sala</h2><p>Tú administras la partida.</p></div>
        <label>Tu nombre<input name="name" maxlength="18" autocomplete="nickname" placeholder="Ej. Martina" required></label>
        <button class="btn primary" ${model.busy ? "disabled" : ""}>Crear sala <span>→</span></button>
      </form>

      <form class="panel room-form" data-form="join-room">
        <span class="form-icon lime" aria-hidden="true">↗</span>
        <div><h2>Unirme</h2><p>Usa el código del anfitrión.</p></div>
        <label>Código<input class="code-input" name="code" maxlength="6" autocomplete="off" inputmode="text" placeholder="ABC123" required></label>
        <label>Tu nombre<input name="name" maxlength="18" autocomplete="nickname" placeholder="Ej. Camila" required></label>
        <button class="btn secondary" ${model.busy ? "disabled" : ""}>Entrar a la sala</button>
      </form>
    </div>
  </section>`;
}

function playerRows() {
  return players().map(player => `<li class="player-row">
    <span class="avatar">${escapeHTML(player.name.slice(0, 2).toUpperCase())}</span>
    <span><strong>${escapeHTML(player.name)}</strong><small>${player.role === "host" ? "Anfitrión" : "Invitado"}</small></span>
    <span class="connection ${player.connected ? "online" : ""}">${player.connected ? "En línea" : "Sin conexión"}</span>
  </li>`).join("");
}

function visibilitySelector(settings) {
  const isPublic = settings.handVisibility === "public";
  return `<fieldset class="visibility-fieldset">
    <legend>Visibilidad de las cartas</legend>
    <label class="choice-card ${!isPublic ? "selected" : ""}">
      <input type="radio" name="handVisibility" value="private" ${!isPublic ? "checked" : ""}>
      <span class="choice-dot"></span>
      <span><strong>Cartas privadas</strong><small>Cada jugador ve solamente su mano.</small></span>
    </label>
    <label class="choice-card ${isPublic ? "selected" : ""}">
      <input type="radio" name="handVisibility" value="public" ${isPublic ? "checked" : ""}>
      <span class="choice-dot"></span>
      <span><strong>Visibles para todos</strong><small>Todas las manos permanecen a la vista.</small></span>
    </label>
  </fieldset>`;
}

function settingsReadOnly(settings) {
  const isPublic = settings.handVisibility === "public";
  return `<div class="readonly-settings">
    <span><small>Visibilidad</small><strong>${isPublic ? "Visibles para todos" : "Cartas privadas"}</strong></span>
    <span><small>Bluff</small><strong>${settings.bluffEnabled ? "Activado" : "Desactivado"}</strong></span>
    <span><small>Cartas</small><strong>${settings.cardsPerPlayer} por jugador</strong></span>
  </div>`;
}

function startSummary(settings) {
  const visibility = settings.handVisibility === "public" ? "Visibles para todos" : "Cartas privadas";
  return `<dl class="start-summary">
    <div><dt>Modo</dt><dd>Clásico</dd></div>
    <div><dt>Jugadores</dt><dd>${players().length}</dd></div>
    <div><dt>Cartas por jugador</dt><dd>${settings.cardsPerPlayer}</dd></div>
    <div><dt>Visibilidad</dt><dd>${visibility}</dd></div>
    <div><dt>Bluff</dt><dd>${settings.bluffEnabled ? "Activado" : "Desactivado"}</dd></div>
    <div><dt>Multiplicadores</dt><dd>${settings.floorMultipliers.map(value => `×${value}`).join(", ")}</dd></div>
  </dl>`;
}

function startConfirmation(settings) {
  if (!model.confirmStart) return "";
  return `<div class="modal-layer" role="presentation">
    <section class="modal panel" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <span class="eyebrow">Revisa la mesa</span>
      <h2 id="confirm-title">¿Todo listo?</h2>
      ${startSummary(settings)}
      <div class="modal-actions">
        <button class="btn ghost" data-action="cancel-start">Volver</button>
        <button class="btn primary" data-action="confirm-start" ${model.busy ? "disabled" : ""}>Confirmar e iniciar</button>
      </div>
    </section>
  </div>`;
}

function renderLobby() {
  const settings = model.room.settings;
  const publicMode = settings.handVisibility === "public";
  root.innerHTML = `<section class="page lobby-page">
    ${brandHeader(`<button class="icon-btn" data-action="leave-room" aria-label="Salir de la sala">×</button>`)}

    <section class="room-code panel">
      <div><span class="eyebrow">Código de sala</span><strong>${escapeHTML(model.roomCode)}</strong></div>
      <button class="copy-button" data-action="copy-code">Copiar</button>
    </section>

    <div class="lobby-grid">
      <section class="panel players-panel">
        <div class="panel-heading"><div><h2>La mesa</h2><p>Comparte el código con tu grupo.</p></div><span class="count-pill">${players().length}/12</span></div>
        <ul class="player-list">${playerRows()}</ul>
      </section>

      <section class="panel settings-panel">
        <div class="panel-heading"><div><h2>Configuración</h2><p>${isHost() ? "Solo tú puedes modificarla." : "El anfitrión controla estas opciones."}</p></div><span class="host-lock">⌁</span></div>
        ${isHost() ? `<form data-form="settings">
          ${visibilitySelector(settings)}
          <label class="select-setting"><span><strong>Cartas por jugador</strong><small>Entre 3 y 6 cartas.</small></span>
            <select name="cardsPerPlayer">
              ${[3,4,5,6].map(value => `<option value="${value}" ${settings.cardsPerPlayer === value ? "selected" : ""}>${value}</option>`).join("")}
            </select>
          </label>
          <label class="toggle-setting ${publicMode ? "disabled" : ""}">
            <span><strong>Bluff</strong><small>Permite declaraciones falsas.</small></span>
            <input type="checkbox" name="bluffEnabled" ${settings.bluffEnabled ? "checked" : ""} ${publicMode ? "disabled" : ""}>
            <i></i>
          </label>
          ${publicMode ? `<p class="compatibility-note">El bluff no está disponible con las cartas visibles, porque todos pueden comprobar las coincidencias.</p>` : ""}
        </form>` : settingsReadOnly(settings)}
      </section>
    </div>

    ${isHost() ? `<button class="btn primary start-room" data-action="review-start" ${players().length < 3 || model.busy ? "disabled" : ""}>
      ${players().length < 3 ? "Esperando al menos 3 jugadores" : "Revisar e iniciar"} <span>→</span>
    </button>` : `<div class="waiting-host"><i></i> Esperando al anfitrión…</div>`}
    ${startConfirmation(settings)}
  </section>`;
}

function pyramidMarkup() {
  const cards = model.room.game?.pyramidCards || [];
  const rows = [[0], [1,2], [3,4,5], [6,7,8,9], [10,11,12,13,14]];
  return `<div class="pyramid-board" aria-label="Pirámide de cartas">
    ${rows.map(row => `<div class="pyramid-row">${row.map(position => {
      const card = cards[position];
      if (!card?.revealed) return `<span class="pyramid-card back"><i>${position === 0 ? "♛" : "◆"}</i></span>`;
      return `<span class="pyramid-card face ${card.color === "red" ? "red" : ""}"><b>${escapeHTML(card.value)}</b><i>${escapeHTML(card.symbol)}</i></span>`;
    }).join("")}</div>`).join("")}
  </div>`;
}

function playerGameRows() {
  return players().map(player => `<li class="game-player ${player.uid === model.user.uid ? "me" : ""}">
    <span class="avatar">${escapeHTML(player.name.slice(0, 2).toUpperCase())}</span>
    <span class="game-player-name"><strong>${escapeHTML(player.name)}</strong><small>${player.availableCards || 0} disponibles / ${player.usedCards || 0} usadas</small></span>
    <span class="player-score">💀 ${player.skulls || 0}<br>♛ ${player.crowns || 0}</span>
    <i class="status-dot ${player.connected ? "online" : ""}" title="${player.connected ? "En línea" : "Sin conexión"}"></i>
  </li>`).join("");
}

function currentUserHand() {
  if (model.room.settings.handVisibility === "public") {
    return model.publicHands?.[model.user.uid]?.cards || {};
  }
  return model.privateHand || {};
}

function canDeclare() {
  const game = model.room.game;
  if (!game?.currentCard || game.activeClaim || game.declaredThisCard?.[model.user.uid]) return false;
  if (model.room.settings.bluffEnabled) return true;
  return cardsOf(currentUserHand()).some(card => !card.used && card.value === game.currentCard.value);
}

function activeClaimMarkup() {
  const claim = model.room.game?.activeClaim;
  if (!claim) return "";
  const claimant = model.room.players[claim.claimantUid];
  const target = model.room.players[claim.targetUid];
  const isTarget = claim.targetUid === model.user.uid;
  const publicMode = model.room.settings.handVisibility === "public";
  return `<section class="claim-banner panel">
    <span class="eyebrow">Declaración pendiente</span>
    <h3>${escapeHTML(claimant?.name)} declara ${escapeHTML(claim.claimedValue)}</h3>
    <p>Le entrega una carga ×${claim.multiplier} a <strong>${escapeHTML(target?.name)}</strong>.</p>
    ${isTarget ? `<div class="claim-actions">
      <button class="btn secondary" data-action="resolve-claim" data-decision="accept">Aceptar carga</button>
      ${publicMode ? "" : `<button class="btn danger" data-action="resolve-claim" data-decision="challenge">Desafiar</button>`}
    </div>` : `<small>Esperando la decisión de ${escapeHTML(target?.name)}…</small>`}
  </section>`;
}

function lastResultMarkup() {
  const result = model.room.game?.lastResult;
  if (!result) return "";
  const claimant = model.room.players[result.claimantUid];
  const target = model.room.players[result.targetUid];
  const truth = result.truthful === null || result.truthful === undefined
    ? "La verdad permanece oculta."
    : result.truthful ? "La coincidencia era real." : "Era un bluff.";
  return `<section class="result-banner panel">
    <span class="eyebrow">Resultado</span>
    <h3>${escapeHTML(result.title)}</h3>
    <p>${escapeHTML(claimant?.name)} → ${escapeHTML(target?.name)}. ${truth}</p>
  </section>`;
}

function targetPicker() {
  if (!model.claimPicker) return "";
  const options = players().filter(player => player.uid !== model.user.uid);
  return `<div class="modal-layer">
    <section class="modal panel" role="dialog" aria-modal="true" aria-labelledby="target-title">
      <span class="eyebrow">Tu declaración</span>
      <h2 id="target-title">¿Quién recibe la carga?</h2>
      <div class="target-grid">${options.map(player => `<button data-action="select-target" data-uid="${escapeHTML(player.uid)}"><span class="avatar">${escapeHTML(player.name.slice(0,2).toUpperCase())}</span><strong>${escapeHTML(player.name)}</strong></button>`).join("")}</div>
      <button class="btn ghost full" data-action="cancel-claim">Cancelar</button>
    </section>
  </div>`;
}

function privateHandPanel() {
  if (!model.handPanel || model.room.settings.handVisibility !== "private") return "";
  const cards = cardsOf(model.privateHand);
  return `<div class="hand-overlay">
    <section class="hand-sheet panel" role="dialog" aria-modal="true" aria-labelledby="private-hand-title">
      <button class="sheet-close" data-action="close-hand" aria-label="Cerrar">×</button>
      <span class="eyebrow">Solo para ti</span>
      <h2 id="private-hand-title">Mi mano</h2>
      <p>Mantén presionado para revelar. Se ocultará al soltar o salir de la aplicación.</p>
      <div id="private-hand-tray" class="hand-tray">${cards.map(card => cardMarkup(card, { hidden: !model.handRevealed })).join("")}</div>
      <button class="hold-reveal" data-hold-hand ${cards.length ? "" : "disabled"}>
        <span>◉</span><strong>Mantén presionado para revelar</strong>
      </button>
      <div class="hand-counts"><span>${cards.filter(card => !card.used).length} disponibles</span><span>${cards.filter(card => card.used).length} utilizadas</span></div>
    </section>
  </div>`;
}

function publicHandsPanel() {
  if (!model.handPanel || model.room.settings.handVisibility !== "public") return "";
  return `<div class="hand-overlay">
    <section class="all-hands-sheet panel" role="dialog" aria-modal="true" aria-labelledby="all-hands-title">
      <button class="sheet-close" data-action="close-hand" aria-label="Cerrar">×</button>
      <span class="eyebrow">Estado sincronizado</span>
      <h2 id="all-hands-title">Todas las manos</h2>
      <div class="all-hands-list">${players().map(player => {
        const cards = cardsOf(model.publicHands?.[player.uid]);
        return `<article class="public-hand">
          <header><div><strong>${escapeHTML(player.name)}</strong><small>${cards.filter(card => !card.used).length} disponibles · ${cards.filter(card => card.used).length} usadas</small></div></header>
          <div class="hand-tray compact-tray">${cards.map(card => cardMarkup(card, { compact: true })).join("")}</div>
        </article>`;
      }).join("")}</div>
    </section>
  </div>`;
}

function renderGame() {
  const game = model.room.game || {};
  const current = game.currentCard;
  const completed = (game.pyramidIndex || 0) >= 15;
  const publicMode = model.room.settings.handVisibility === "public";
  root.innerHTML = `<section class="page game-page">
    ${brandHeader(`<div class="room-mini"><small>Sala</small><strong>${escapeHTML(model.roomCode)}</strong></div>`)}
    <div class="game-layout">
      <main class="table-column">
        <header class="game-heading">
          <div><span class="eyebrow">Ronda ${game.round || 1} · Piso ${game.currentFloor || 1}</span><h1>Pirámide</h1></div>
          <span class="visibility-pill">${publicMode ? "Manos visibles" : "Manos privadas"}</span>
        </header>
        <section class="board-panel panel">${pyramidMarkup()}</section>
        ${current ? `<section class="current-card-panel panel">
          <div><span class="eyebrow">Carta activa</span><h2>${escapeHTML(current.value)}${escapeHTML(current.symbol)}</h2><p>Carga ×${model.room.settings.floorMultipliers[(game.currentFloor || 1) - 1]}</p></div>
          ${cardMarkup(current)}
        </section>` : `<p class="empty-current">El anfitrión debe revelar la siguiente carta.</p>`}
        ${activeClaimMarkup()}
        ${lastResultMarkup()}
        <div class="game-actions">
          ${isHost() ? `<button class="btn primary" data-action="${completed ? "finish-round" : "reveal-card"}" ${game.activeClaim || model.busy ? "disabled" : ""}>${completed ? "Terminar ronda" : current ? "Revelar siguiente" : "Revelar primera carta"}</button>` : ""}
          <button class="btn secondary" data-action="open-claim" ${canDeclare() && !model.busy ? "" : "disabled"}>Declarar coincidencia</button>
        </div>
      </main>
      <aside class="players-column panel">
        <div class="panel-heading"><div><h2>Jugadores</h2><p>Estado en tiempo real</p></div><span class="count-pill">${players().length}</span></div>
        <ul class="game-player-list">${playerGameRows()}</ul>
      </aside>
    </div>
    <button class="floating-hand" data-action="open-hand"><span>${publicMode ? "▦" : "🂠"}</span><strong>${publicMode ? "Ver todas las manos" : "Mi mano"}</strong></button>
    ${targetPicker()}
    ${privateHandPanel()}
    ${publicHandsPanel()}
  </section>`;
}

function renderFinished() {
  const ranking = [...players()].sort((left, right) => (left.skulls || 0) - (right.skulls || 0));
  root.innerHTML = `<section class="page finish-page">
    ${brandHeader()}
    <article class="finish-card panel">
      <span class="finish-crown">♛</span>
      <p class="eyebrow">Ronda terminada</p>
      <h1>La cima habló.</h1>
      <div class="ranking">${ranking.map((player, index) => `<div class="${index === 0 ? "winner" : ""}"><b>${index + 1}</b><span><strong>${escapeHTML(player.name)}</strong><small>${player.usedCards || 0} cartas usadas</small></span><em>💀 ${player.skulls || 0}</em></div>`).join("")}</div>
      ${isHost() ? `<button class="btn primary full" data-action="prepare-rematch">Preparar nueva ronda</button>` : `<p class="waiting-host"><i></i> Esperando al anfitrión…</p>`}
      <button class="btn ghost full" data-action="leave-room">Salir de la sala</button>
    </article>
  </section>`;
}

function render() {
  if (!model.user && !model.demo) return;
  if (!model.room) {
    renderHome();
    return;
  }
  if (model.room.status === "lobby" || model.room.status === "starting") {
    renderLobby();
    return;
  }
  if (model.room.status === "finished") {
    renderFinished();
    return;
  }
  renderGame();
}

function settingsFromForm(form) {
  const handVisibility = form.elements.handVisibility.value;
  return {
    handVisibility,
    cardsPerPlayer: Number(form.elements.cardsPerPlayer.value),
    bluffEnabled: handVisibility === "public" ? false : form.elements.bluffEnabled.checked,
    powersEnabled: false,
    floorMultipliers: [1, 2, 4, 8, 16]
  };
}

root.addEventListener("submit", event => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);

  if (form.dataset.form === "create-room") {
    const name = data.get("name");
    run(async () => {
      const response = await api.createRoom({ name });
      setSession(response.code, name);
      subscribeRoomState(response.code);
    });
  }
  if (form.dataset.form === "join-room") {
    const name = data.get("name");
    const code = String(data.get("code") || "").toUpperCase();
    run(async () => {
      const response = await api.joinRoom({ code, name });
      setSession(response.code, name);
      subscribeRoomState(response.code);
    });
  }
});

root.addEventListener("change", event => {
  const form = event.target.closest('form[data-form="settings"]');
  if (!form || !isHost()) return;
  const next = settingsFromForm(form);
  model.room.settings = { ...model.room.settings, ...next };
  render();
  run(() => api.updateRoomSettings({ code: model.roomCode, settings: next }));
});

root.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "copy-code") {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(model.roomCode)
        .then(() => showToast("Código copiado."))
        .catch(() => showToast(`Código: ${model.roomCode}`));
    } else {
      showToast(`Código: ${model.roomCode}`);
    }
  }
  if (action === "leave-room") {
    if (model.demo) return leaveLocalRoom();
    run(async () => {
      await api.leaveRoom({ code: model.roomCode });
      leaveLocalRoom();
    });
  }
  if (action === "review-start") {
    model.confirmStart = true;
    render();
  }
  if (action === "cancel-start") {
    model.confirmStart = false;
    render();
  }
  if (action === "confirm-start") {
    model.confirmStart = false;
    run(() => api.startOnlineGame({ code: model.roomCode }));
  }
  if (action === "reveal-card") {
    run(() => api.revealNextCard({ code: model.roomCode }));
  }
  if (action === "finish-round") {
    run(() => api.finishOnlineGame({ code: model.roomCode }));
  }
  if (action === "open-claim") {
    model.claimPicker = true;
    render();
  }
  if (action === "cancel-claim") {
    model.claimPicker = false;
    render();
  }
  if (action === "select-target") {
    const targetUid = button.dataset.uid;
    model.claimPicker = false;
    run(() => api.submitClaim({ code: model.roomCode, targetUid }));
  }
  if (action === "resolve-claim") {
    const operation = button.dataset.decision === "challenge"
      ? api.challengeClaim
      : api.acceptClaim;
    run(() => operation({ code: model.roomCode }));
  }
  if (action === "open-hand") {
    model.handPanel = true;
    model.handRevealed = false;
    render();
  }
  if (action === "close-hand") {
    model.handPanel = false;
    model.handRevealed = false;
    render();
  }
  if (action === "prepare-rematch") {
    run(() => api.restartOnlineRound({ code: model.roomCode }));
  }
});

function updatePrivateCardsVisual() {
  const tray = document.querySelector("#private-hand-tray");
  if (!tray) return;
  tray.innerHTML = cardsOf(model.privateHand)
    .map(card => cardMarkup(card, { hidden: !model.handRevealed }))
    .join("");
  tray.classList.toggle("revealed", model.handRevealed);
}

root.addEventListener("pointerdown", event => {
  if (!event.target.closest("[data-hold-hand]")) return;
  event.preventDefault();
  model.handRevealed = true;
  updatePrivateCardsVisual();
});

function concealPrivateHand() {
  if (!model.handRevealed) return;
  model.handRevealed = false;
  updatePrivateCardsVisual();
}

window.addEventListener("pointerup", concealPrivateHand);
window.addEventListener("pointercancel", concealPrivateHand);
window.addEventListener("blur", concealPrivateHand);
window.addEventListener("pagehide", concealPrivateHand);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) concealPrivateHand();
});

function demoCard(id, value, symbol, suit, color, used = false) {
  return { id, value, symbol, suit, color, used };
}

function demoRoom(mode) {
  const visibility = mode === "public" ? "public" : "private";
  const demoPlayers = {
    "demo-host": { ...demoPlayer("demo-host", "Marti", "host"), availableCards: 3, usedCards: 1 },
    "demo-cami": { ...demoPlayer("demo-cami", "Camila", "guest"), availableCards: 2, usedCards: 2 },
    "demo-nico": { ...demoPlayer("demo-nico", "Nico", "guest"), availableCards: 4, usedCards: 0 }
  };
  if (mode === "lobby") {
    return {
      code: "VACILA",
      hostUid: "demo-host",
      status: "lobby",
      settings: { handVisibility: "private", bluffEnabled: true, powersEnabled: false, cardsPerPlayer: 4, floorMultipliers: [1,2,4,8,16] },
      players: demoPlayers
    };
  }
  const cards = [
    demoCard("c1", "7", "♥", "hearts", "red"),
    demoCard("c2", "Q", "♣", "clubs", "black", true),
    demoCard("c3", "4", "♦", "diamonds", "red"),
    demoCard("c4", "A", "♠", "spades", "black")
  ];
  const pyramidCards = Array.from({ length: 15 }, (_, position) => ({
    ...demoCard(`p${position}`, ["A","2","3","4","5","6","7","8","9","10","J","Q","K","3","7"][position], position % 2 ? "♣" : "♥", position % 2 ? "clubs" : "hearts", position % 2 ? "black" : "red"),
    position,
    revealed: position >= 10
  }));
  model.privateHand = Object.fromEntries(cards.map(card => [card.id, card]));
  model.publicHands = Object.fromEntries(Object.keys(demoPlayers).map((uid, index) => [
    uid,
    { cards: Object.fromEntries(cards.map(card => [`${card.id}-${index}`, { ...card, id: `${card.id}-${index}` }])) }
  ]));
  return {
    code: "VACILA",
    hostUid: "demo-host",
    status: "playing",
    settings: { handVisibility: visibility, bluffEnabled: visibility === "private", powersEnabled: false, cardsPerPlayer: 4, floorMultipliers: [1,2,4,8,16] },
    players: demoPlayers,
    game: {
      round: 1,
      pyramidCards,
      revealOrder: [10,11,12,13,14,6,7,8,9,3,4,5,1,2,0],
      pyramidIndex: 5,
      currentFloor: 1,
      currentCard: pyramidCards[14],
      declaredThisCard: {}
    }
  };
}

function demoPlayer(uid, name, role) {
  return {
    uid,
    name,
    role,
    joinedAt: Date.now(),
    connected: true,
    skulls: role === "host" ? 2 : 0,
    crowns: role === "host" ? 1 : 0,
    availableCards: 0,
    usedCards: 0
  };
}

async function start() {
  const query = new URLSearchParams(location.search);
  const demo = query.get("demo");
  if (demo) {
    model.demo = true;
    model.user = { uid: "demo-host" };
    model.roomCode = "VACILA";
    model.room = demoRoom(demo);
    model.handPanel = query.get("panel") === "hands";
    model.handRevealed = query.get("reveal") === "1";
    render();
    return;
  }

  if (!isFirebaseConfigured()) {
    model.user = { uid: "configuration" };
    renderConfiguration();
    return;
  }

  try {
    firebaseService = await import("./firebase-service.js");
    api = firebaseService.api;
    await firebaseService.initializeFirebase();
    model.user = await firebaseService.waitForUser();
    const session = readSession();
    if (session?.code) subscribeRoomState(session.code);
    else render();
  } catch (error) {
    console.error("No se pudo inicializar Firebase:", error);
    model.user = { uid: "configuration" };
    renderConfiguration();
    showToast(humanizeFirebaseError(error));
  }
}

start();
