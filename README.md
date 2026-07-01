# Juegos para Vacilar

Una app web móvil que reúne cinco experiencias sociales para jugar en grupo. La portada, la navegación y la identidad visual viven en este repositorio; cada juego mantiene su desarrollo independiente.

## Juegos incluidos

- [La Botellita](https://github.com/mfuentespagliero/la-botellita-mobile)
- [Pirámide Simple](https://github.com/mfuentespagliero/PIRAMIDE-MOBILE)
- **Pirámide Multijugador:** versión online con salas, anfitrión, manos privadas o públicas y backend Firebase autoritativo.
- [El Impostor](https://github.com/mfuentespagliero/IMPOSTOR-MOBILE)
- [Cuarto Rey](https://github.com/mfuentespagliero/CUARTO-REY-MOBILE)

Los juegos están conectados mediante **submódulos Git**. Así pueden evolucionar y publicarse por separado sin duplicar su historial dentro de este proyecto.

## Abrir el proyecto

Clona el repositorio incluyendo sus submódulos:

```bash
git clone --recurse-submodules https://github.com/mfuentespagliero/juego-para-vacilar.git
cd juego-para-vacilar
```

Luego abre `index.html` directamente o sirve la carpeta con cualquier servidor estático.

Si ya clonaste el proyecto sin los juegos:

```bash
git submodule update --init --recursive
```

## Actualizar los juegos manualmente

```bash
git submodule update --remote --merge
git add PIRAMIDE-MOBILE-SIMPLE IMPOSTOR-MOBILE CUARTO-REY-MOBILE LA-BOTELLITA-MOBILE
git commit -m "chore: actualizar juegos"
```

El workflow `Actualizar juegos` también revisa automáticamente las ramas `main` de los cuatro repositorios y actualiza sus referencias cuando hay cambios publicados.

## Publicación

GitHub Actions construye y publica la app completa en GitHub Pages. La portada se encuentra en la raíz y cada juego se carga desde su submódulo dentro del contenedor común.

Sitio previsto: <https://mfuentespagliero.github.io/juego-para-vacilar/>

## Estructura

```text
├── index.html                  # Menú principal
├── play.html                   # Contenedor común de juego
├── css/ js/ assets/            # Identidad y lógica del hub
├── LA-BOTELLITA-MOBILE/        # Submódulo
├── PIRAMIDE-MOBILE-SIMPLE/     # Submódulo · versión local actual
├── PIRAMIDE-MOBILE-MULTIJUGADOR/ # Base independiente para la versión online
├── IMPOSTOR-MOBILE/            # Submódulo
├── CUARTO-REY-MOBILE/          # Submódulo
└── .github/workflows/          # Actualización y despliegue
```
