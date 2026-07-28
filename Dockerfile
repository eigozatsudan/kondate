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
# GHA 等 LOCAL_UID≠1000 では app-entrypoint が HOME=/home/kondate にする。
# 既定の $HOME/.cache/ms-playwright に入れると実行時に見つからないため、
# UID 非依存の固定パスへ入れ、任意 uid から読めるようにする。
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install-deps chromium \
  && npx playwright install chromium \
  && chmod -R a+rX /ms-playwright
USER node

FROM dependencies AS build
COPY . .
RUN npm run build
