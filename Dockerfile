FROM node:20-alpine

WORKDIR /app

# Install build dependencies for native modules if needed
RUN apk add --no-cache python3 make g++

# Install project dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and assets
COPY . .

# Build TypeScript and bundle assets into dist/
RUN npm run build

# Expose HTTP port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

CMD ["npm", "start"]
