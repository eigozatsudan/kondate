FROM node:24-bookworm-slim AS dependencies
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
RUN chown -R node:node /workspace

FROM dependencies AS development
COPY --chown=node:node . .
USER node
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM dependencies AS build
COPY . .
RUN npm run build
