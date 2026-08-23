FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src

# Declared after npm ci so changing the version does not bust the dependency
# layer. package.json on main is never bumped (semantic-release publishes the
# version without committing it back), so without this the container would
# report the starting version forever.
ARG VERSION=
RUN if [ -n "$VERSION" ]; then npm pkg set version="$VERSION"; fi

RUN npm run build && npm prune --omit=dev

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# From the build stage, so it carries the version set above.
COPY --from=build /app/package.json ./

USER node

# stdio transport: the container speaks JSON-RPC over stdin and stdout, so it
# needs -i and nothing may print to stdout outside the protocol.
ENTRYPOINT ["node", "dist/index.js"]
