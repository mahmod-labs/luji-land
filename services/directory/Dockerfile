FROM node:22-slim

# Prisma needs openssl at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Apply migrations, then start. A service must migrate independently (rule 6 + SKILL).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
