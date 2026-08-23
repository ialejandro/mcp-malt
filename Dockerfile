FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node

# stdio transport: the container speaks JSON-RPC over stdin and stdout, so it
# needs -i and nothing may print to stdout outside the protocol.
ENTRYPOINT ["node", "dist/index.js"]
