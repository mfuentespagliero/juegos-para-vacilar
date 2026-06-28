(function () {
  "use strict";

  const gameLinks = [...document.querySelectorAll("[data-game]")];
  const continueLink = document.getElementById("continue-game");
  const storageKey = "juego-para-vacilar:last-game";

  function readLastGame() {
    try { return JSON.parse(localStorage.getItem(storageKey)); }
    catch (_) { return null; }
  }

  function showLastGame() {
    const lastGame = readLastGame();
    const matchingLink = lastGame && gameLinks.find(link => link.getAttribute("href") === lastGame.href);
    if (!matchingLink) return;

    continueLink.href = lastGame.href;
    continueLink.querySelector("strong").textContent = `Continuar ${lastGame.name}`;
    continueLink.hidden = false;
  }

  gameLinks.forEach(link => {
    link.addEventListener("click", () => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          name: link.dataset.game,
          href: link.getAttribute("href")
        }));
      } catch (_) { /* El menú funciona aunque el almacenamiento esté bloqueado. */ }

      document.body.classList.add("is-leaving");
      link.classList.add("selected");
    });
  });

  showLastGame();
})();
