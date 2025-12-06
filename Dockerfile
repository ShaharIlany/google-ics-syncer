FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lockb ./

RUN bun install --production

COPY . .

ENV NODE_ENV=production

CMD ["bun", "sync.ts"]


