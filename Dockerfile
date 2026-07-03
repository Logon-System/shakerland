FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public/ ./public/
COPY data/ ./data/

ENV PORT=3000
ENV PICTURES_DIR=/images

EXPOSE 3000

USER node

CMD ["node", "server.js"]
