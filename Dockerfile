FROM node:20-alpine
WORKDIR /app
RUN npm install ws
COPY tools/mock-orders-ws-server.mjs ./tools/
CMD ["node", "tools/mock-orders-ws-server.mjs"]