FROM node:22-alpine AS client
WORKDIR /app
COPY shared ./shared
COPY client/package*.json ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && npm run build

FROM node:22-alpine
WORKDIR /app
COPY shared ./shared
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY --from=client /app/client/dist ./client/dist
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "server/src/index.js"]
