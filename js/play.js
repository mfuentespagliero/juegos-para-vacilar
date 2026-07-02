(function () {
  "use strict";

  const games = {
    "botellita": { name: "La Botellita", path: "LA-BOTELLITA-MOBILE/index.html", theme: "#11100f" },
    "piramide": { name: "Pirámide", path: "PIRAMIDE-MOBILE-SIMPLE/index.html", theme: "#11100f", bodyClass: "game-piramide" },
    "piramide-multijugador": { name: "Pirámide", path: "PIRAMIDE-MOBILE-SIMPLE/index.html", theme: "#11100f", bodyClass: "game-piramide" },
    "cuarto-rey": { name: "Cuarto Rey", path: "CUARTO-REY-MOBILE/index.html", theme: "#11100f", bodyClass: "game-cuarto-rey" },
    "impostor": { name: "El Impostor", path: "IMPOSTOR-MOBILE/index.html", theme: "#11100f", bodyClass: "game-impostor" }
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
  document.title = `${game.name} · Juegos para Vacilar`;
  document.querySelector('meta[name="theme-color"]').content = game.theme;

  function revealFrame() {
    loader.hidden = true;
    frame.hidden = false;
  }

  frame.addEventListener("load", () => {
    if (!game.bodyClass) {
      revealFrame();
      return;
    }

    try {
      const gameDocument = frame.contentDocument;
      gameDocument.body.classList.add(game.bodyClass);

      const themeUrl = new URL("css/game-theme.css?v=2", location.href).href;
      const currentTheme = [...gameDocument.querySelectorAll('link[rel="stylesheet"]')]
        .find(link => link.href.includes("/css/game-theme.css"));

      if (currentTheme) {
        currentTheme.href = themeUrl;
        revealFrame();
        return;
      }

      const themeLink = gameDocument.createElement("link");
      themeLink.rel = "stylesheet";
      themeLink.href = themeUrl;
      themeLink.addEventListener("load", revealFrame, { once: true });
      themeLink.addEventListener("error", revealFrame, { once: true });
      gameDocument.head.append(themeLink);
      window.setTimeout(revealFrame, 900);
    } catch (_) {
      revealFrame();
    }
  }, { once: true });

  frame.src = game.path;
})();
