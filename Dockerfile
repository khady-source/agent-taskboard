# Builds the dashboard and the API into one small image.
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package*.json server/
COPY web/package*.json web/
RUN cd server && npm ci && cd ../web && npm ci
COPY . .
RUN cd web && npm run build \
 && cd ../server && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
