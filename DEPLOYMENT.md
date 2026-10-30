# Deploying Parking Atlas with MongoDB

Parking Atlas now has a Node server that serves the map and its API together. Run it on a Node host or container host that can make outbound MongoDB connections. The current ChatGPT Sites deployment is static; it cannot connect to MongoDB directly.

## Run locally

```sh
npm install
npm start
```

Open `http://localhost:3001`. No app username or password is required.

On first launch, the server checks MongoDB. If the `spots` collection is empty, it loads the bundled parking records once. It does not replace records in a non-empty collection. Changes made in the map are written to MongoDB; the browser also keeps a local cache for offline viewing.

If the old static app has edits saved only in that browser, export those edits to Excel before switching. The shared MongoDB list becomes the source of truth for the Node-hosted app.

## Deploy to a Node host

Use Node.js 20.19 or newer and run `npm ci` as the build/install command and `npm start` as the start command. The included `Dockerfile` is also ready for container hosting.

Set these environment variables in the host's private settings, using the matching values from your local `.env`:

- `MONGODB_URI` — MongoDB connection string
- `MONGODB_DATABASE` — `parking_atlas`
- `MONGODB_COLLECTION` — `spots`

The server uses port 3001 locally by default. Hosting providers can supply `PORT` automatically; it does not need to be in `.env`.

Do not commit or bake `.env` into a container image. It is ignored by Git and Docker. `.env.example` lists the required names without real credentials.

The existing Sites URL remains a static, browser-local version. To use shared MongoDB storage, open the Node-hosted URL after deployment.
