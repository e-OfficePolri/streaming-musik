# Multi-stage build supaya image final kecil — tidak bawa devDependencies
# atau source TypeScript, hanya hasil compile.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist

EXPOSE 3003
CMD ["node", "dist/main.js"]
