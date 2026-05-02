---
title: "20 segundos para reconectarse sin perder la pelea"
date: "TBD"
summary: "Cómo el rollback, una pausa con cartelito y un timer del server convierten un bajón de señal en un susto que no te cuesta el round."
audience: "es-friends"
status: "draft"
---

Imaginate la escena: estás peleando en línea desde el celu, tirando una special
cuando justo el ascensor te come la señal. Antes, eso era game over: el
oponente veía "DESCONECTADO" y te perdiste el round (y la dignidad). Ahora hay
una red de tres capas que aguanta el bajón sin que ninguno de los dos se
entere demasiado.

## Capa 1: el rollback no se da cuenta

Los primeros 117ms de silencio (7 frames a 60 fps, el `maxRollbackFrames`
default) ni siquiera disparan nada. El sistema de rollback ya predice tus
inputs cuando hay un poco de lag — repite tu última dirección, asume que no
estás atacando — y cuando llegan los inputs reales, si pifió, rebobina y
vuelve a simular. Para una desconexión cortita esto basta: el opo no ve
absolutamente nada raro.

## Capa 2: pausa con cuenta regresiva

Si la cosa dura más, FightScene levanta un overlay negro semi-transparente con
un cartelito que dice **"RECONECTANDO..."** y abajo una cuenta regresiva en
segundos. La simulación se pausa — los timers, los inputs, el round, todo
congelado. Ningún jugador puede aprovechar para hacer trampita: si vos te
desconectaste, el opo también ve la pausa y espera.

Mientras tanto, el server arrancó un timer de **20 segundos** y le reservó tu
slot. Tu fighter sigue ahí, parado, esperándote.

## Capa 3: rejoin

Cuando vuelve el WiFi, PartySocket reconecta solito y el cliente manda
`{ type: 'rejoin', slot: N }`. El server cancela el timer, te devuelve el
asiento y le avisa al opo con `opponent_reconnected`. La pausa se levanta y
seguís peleando como si nada hubiera pasado. Bonus: el WebRTC también se
re-negocia en background, así que volvés a P2P sin notarlo.

Si te tardás más de 20 segundos, ahí sí: el server expira el grace period y
manda `return_to_select` al que se quedó (o `disconnect`, si la pelea ni
había arrancado). El que sobrevivió no queda colgado en una FightScene
zombie — vuelve a la pantalla de selección y puede esperar a otro
contrincante.

## Por qué 20 segundos y no 5

La idea original era 5. En la práctica el celular tarda más de lo que uno
piensa en reencontrarse con la red — Safari en iOS especialmente puede demorar
varios segundos solo en disparar el evento `close` del WebSocket. Después suma
un par de pongs perdidos para que el cliente note el bajón (`PONG_TIMEOUT_MS`
son 6 segundos) y ya consumiste medio presupuesto antes de empezar a contar.
Con 20 segundos hay aire para casi cualquier bache de cobertura sin
abandonar la pelea.

## El estado del cuarto importa

El truco fino es que el server recuerda en `_stateBeforeGrace` qué estaba
pasando antes del bajón. Si la pelea no había empezado todavía (estaban en
selección o cargando), una expiración manda al otro de vuelta al menú con la
sala todavía viva. Si estaban peleando en serio, manda `return_to_select` y
la sala queda lista para un nuevo opo. Sin esto, una desconexión cualquiera
te dejaba mirando una pantalla congelada para siempre.

Moraleja: si se te corta WhatsApp mientras estás peleando, respirá. Tenés
tiempo.

## Fuentes

- [#22 — Graceful reconnection during fight](https://github.com/simon0191/a-los-traques/pull/22)
- `apps/party/server.js`, `packages/game/src/systems/ReconnectionManager.js`,
  `packages/game/src/scenes/FightScene.js`, `docs/graceful-reconnection.md`
