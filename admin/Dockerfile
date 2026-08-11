# Task 8 で本番用 multi-stage に差し替える。Task 1 は compose build context 用の最小プレースホルダ。
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
# package-lock が揃うまで install は Task 3 以降
CMD ["node", "-e", "console.log('admin image placeholder; complete Task 3+')"]
