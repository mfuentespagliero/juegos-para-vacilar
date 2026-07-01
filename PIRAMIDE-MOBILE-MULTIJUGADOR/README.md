# Pirámide Mobile Multijugador — beta Spark

Versión online de Pirámide para 2 a 8 jugadores. Funciona con Firebase Authentication anónima, Realtime Database y GitHub Pages, sin Cloud Functions, Cloud Run, servidores propios ni servicios que requieran facturación.

> Esta implementación está diseñada para pruebas privadas. La lógica crítica se ejecuta en los clientes y no ofrece seguridad equivalente a un backend confiable.

La advertencia anterior es parte de la documentación y no se muestra dentro de la interfaz normal del juego. La versión local continúa aislada en `../PIRAMIDE-MOBILE-SIMPLE`.

## Qué incluye

- Salas con códigos únicos de seis caracteres, sin `O`, `0`, `I` ni `1`.
- Autenticación anónima persistente y reconexión después de actualizar.
- Lobby, presencia con `.info/connected` y configuración exclusiva del host.
- Reparto desde el navegador del host con manos privadas o públicas.
- Mazo oculto de la pirámide en `hostState/{roomCode}` y cartas reveladas en la sala.
- Declaraciones, bluff, aceptación, desafío, cargas y puntajes sincronizados.
- Cierre manual de sala y vencimiento lógico después de 12 horas.
- Reglas para reducir modificaciones accidentales y limitar manos privadas.

La carpeta `functions/` se conserva únicamente como respaldo histórico. No forma parte del frontend, de `firebase.json` ni del despliegue beta.

## Arquitectura de datos

- `rooms/{roomCode}`: lobby, jugadores, configuración y estado público.
- `privateHands/{roomCode}/{uid}/cards`: mano legible solamente por su dueño.
- `rooms/{roomCode}/publicHands`: manos visibles para integrantes de la sala.
- `hostState/{roomCode}/pyramidDeck`: pirámide oculta, legible solamente por el host.
- `claimProofs/{roomCode}/{claimId}`: carta puntual usada para resolver un desafío privado.

El host genera el mazo y escribe temporalmente las manos. `clearSensitiveDealData()` limpia los arrays de reparto al finalizar. Esto mejora la privacidad cotidiana, pero un usuario avanzado aún podría manipular su cliente.

## Preparar Firebase en Spark

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. En **Authentication → Sign-in method**, activa el proveedor **Anónimo** y agrega tu dominio de GitHub Pages en **Authorized domains**.
3. Crea una **Realtime Database**.
4. Registra una aplicación web y pega su `firebaseConfig` en `js/firebase-config.js`. Este repositorio ya contiene la configuración de `vacila-cb462`.
5. Instala Firebase CLI si todavía no lo tienes e inicia sesión.
6. Desde esta carpeta publica solamente las reglas:

```bash
firebase deploy --project vacila-cb462 --only database
```

También puedes usar:

```bash
npm install
npm run deploy
```

El script `deploy` ejecuta exclusivamente el despliegue de Realtime Database. No uses `firebase deploy --only functions` para esta beta.

## Publicar el frontend

Publica la carpeta del repositorio con GitHub Pages. El juego carga los módulos Firebase desde el CDN oficial y no necesita un proceso de compilación. Si Pages sirve el repositorio completo, la entrada es:

```text
PIRAMIDE-MOBILE-MULTIJUGADOR/index.html
```

## Desarrollo y pruebas

Con Node.js, Firebase CLI y las dependencias instaladas:

```bash
npm run emulators
npm test
```

Vistas visuales sin Firebase:

- `index.html?demo=lobby`
- `index.html?demo=private`
- `index.html?demo=public`

## Lista de comprobación

1. Crear una sala y confirmar que el código tenga seis caracteres válidos.
2. Entrar desde dos teléfonos adicionales con cuentas anónimas distintas.
3. Ver los tres jugadores y sus cambios de conexión en tiempo real.
4. Probar manos privadas; cada teléfono debe leer solo la propia.
5. Probar manos públicas; todos deben ver cartas disponibles y usadas.
6. Confirmar que un invitado no pueda configurar, iniciar, revelar, reiniciar ni cerrar.
7. Revelar las 15 cartas y comprobar la sincronización de pisos y multiplicadores.
8. Probar una coincidencia real, un bluff aceptado y un bluff desafiado.
9. Actualizar una página y confirmar la reconexión sin abrir automáticamente la mano.
10. Cerrar la sala como host y comprobar que desaparezcan sala, manos y estado oculto.
11. Verificar en la consola de red que no existan solicitudes a `cloudfunctions.net`.

No existe una tarea programada en Spark para borrar salas exactamente al vencer. La aplicación rechaza salas de más de 12 horas y el host puede cerrarlas manualmente.

## Archivos principales

- `js/app.js`: interfaz, estado visual y listeners.
- `js/firebase-service.js`: Auth, transacciones, presencia y lógica beta.
- `database.rules.json`: permisos de Realtime Database.
- `firebase.json`: reglas, hosting opcional y emuladores sin Functions.
- `tests/rules.test.mjs`: pruebas de privacidad y permisos.
