(function () {
  "use strict";

  const games = {
    "piramide": { name: "Pirámide", path: "PIRAMIDE-MOBILE/index.html", theme: "#17152b" },
    "cuarto-rey": { name: "Cuarto Rey", path: "CUARTO-REY-MOBILE/index.html", theme: "#17152b" },
    "impostor": { name: "El Impostor", path: "IMPOSTOR-MOBILE/index.html", theme: "#15152b" }
  };

  const gameKey = new URLSearchParams(location.search).get("game");
  const game = games[gameKey];
  const frame = document.getElementById("game-frame");
  const loader = document.getElementById("loader");
  const error = document.getElementById("game-error");
  const title = document.getElementById("game-name");

  if (!game) {
    loader.hidden = true;
    error.hidden = false;
    return;
  }

  title.textContent = game.name;
  frame.title = game.name;
  frame.style.background = game.theme;
  document.title = `${game.name} · Juego para Vacilar`;
  document.querySelector('meta[name="theme-color"]').content = game.theme;

  frame.addEventListener("load", () => {
    loader.hidden = true;
    frame.hidden = false;
  }, { once: true });

  frame.src = game.path;
})();
