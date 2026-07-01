# Pirámide Mobile Multijugador

Versión online de Pirámide con salas para 3 a 12 jugadores, anfitrión, sincronización en tiempo real y manos privadas o visibles para todos.

## Funciones incluidas

- Autenticación anónima persistente.
- Creación y acceso mediante códigos de seis caracteres.
- Lobby con configuración exclusiva del anfitrión.
- Selector `settings.handVisibility` con valores `private` y `public`.
- Bloqueo de configuración al comenzar.
- Reparto y acciones validadas por Cloud Functions.
- Manos privadas en `privateHands/{roomCode}/{playerUid}/cards`.
- Manos públicas en `rooms/{roomCode}/publicHands/{playerUid}/cards`.
- Bluff automático desactivado en modalidad pública.
- Declaraciones, aceptación, desafío y consumo autoritativo de cartas.
- Presencia, reconexión y limpieza de listeners.
- Nueva ronda con regreso al lobby.
- Reglas que impiden editar configuraciones, cartas, cargas o puntajes desde el cliente.

La versión local continúa aislada en `../PIRAMIDE-MOBILE-SIMPLE`.

## Requisitos

- Node.js 20.
- Firebase CLI.
- Un proyecto Firebase con plan compatible con Cloud Functions.
- Authentication anónima activada.
- Realtime Database creada.

## Configuración

1. El frontend ya está configurado para el proyecto `vacila-cb462`.
2. Verifica que Realtime Database use `https://vacila-cb462-default-rtdb.firebaseio.com/`.
3. Activa el proveedor **Anónimo** en Authentication.
4. Copia `.firebaserc.example` como `.firebaserc` si quieres usar comandos manuales de Firebase sin pasar `--project vacila-cb462`.
5. Instala dependencias:

```bash
npm install
npm --prefix functions install
```

La región configurada es `southamerica-west1`. Si la cambias en `functions/index.js`, actualiza también `functionsRegion` en `js/firebase-config.js`.

## Emuladores y pruebas

```bash
npm run emulators
npm test
```

Las pruebas cubren reparto, compatibilidad de bluff, consumo único de cartas, privacidad, permisos de sala, presencia y rechazo de escrituras ilegales.

Vistas sin Firebase:

- `index.html?demo=lobby`
- `index.html?demo=private`
- `index.html?demo=public`

## Despliegue

Ejecuta desde la carpeta `PIRAMIDE-MOBILE-MULTIJUGADOR`:

```bash
cd functions
npm install
cd ..
firebase deploy --project vacila-cb462 --only functions
```

Las funciones usan Cloud Functions de segunda generación en `southamerica-west1`, son callable mediante el SDK de Firebase y tienen CORS habilitado. El frontend usa Firebase JavaScript SDK modular 12.15.0.

Para publicar además Hosting y las reglas de Realtime Database puedes usar:

```bash
npm run deploy
```

El script ya apunta al proyecto `vacila-cb462`.

### Verificación posterior al despliegue

1. Crear una sala desde `http://127.0.0.1:5500`.
2. Unirse desde `http://localhost:5500` en otra pestaña.
3. Unirse desde otro teléfono.
4. Repetir la prueba desde `https://juegosparavacilar.cl` y GitHub Pages.
5. Confirmar en la consola que no aparezcan errores CORS.
6. Comprobar que las callables reciban `request.auth.uid`.
7. Confirmar que un invitado no pueda cambiar ajustes, iniciar, revelar cartas ni finalizar la partida.

## Modelo de seguridad

Los clientes solo pueden:

- Leer una sala a la que pertenecen.
- Leer su propia mano privada.
- Leer las manos públicas de su sala.
- Actualizar sus campos de presencia.
- Invocar funciones autenticadas.

Todos los cambios de configuración y partida se ejecutan con Admin SDK dentro de Cloud Functions. Las rutas `roomSecrets` nunca son legibles por clientes y almacenan temporalmente la verdad de una declaración para que un bluff no pueda descubrirse inspeccionando la sala.

## Archivos principales

- `js/app.js`: interfaz, listeners y privacidad al perder foco.
- `js/firebase-service.js`: Authentication, Database y callables.
- `functions/index.js`: servidor autoritativo.
- `functions/src/game.js`: reparto y reglas puras.
- `database.rules.json`: autorización de clientes.
- `tests/rules.test.mjs`: pruebas de reglas con Emulator Suite.
