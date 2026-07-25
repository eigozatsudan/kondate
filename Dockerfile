FROM node:24-bookworm-slim AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
RUN chown -R node:node /workspace

FROM dependencies AS development
COPY --chown=node:node . .
# Compose は user:0 で起動し app-entrypoint が LOCAL_UID へ落とす。
# イメージ内の既定 USER は node のままにし、直接 docker run したときも非 root とする。
COPY scripts/app-entrypoint.sh /usr/local/bin/app-entrypoint.sh
RUN chmod 755 /usr/local/bin/app-entrypoint.sh
USER node
EXPOSE 5173
ENTRYPOINT ["/usr/local/bin/app-entrypoint.sh"]
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM development AS e2e
USER root
RUN npx playwright install-deps chromium
USER node
RUN npx playwright install chromium

FROM dependencies AS build
COPY . .
RUN npm run build
