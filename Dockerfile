# Used by bt-automation's docker-compose to run this server over HTTP.
# One container per mailbox: ACCOUNT selects which one at boot.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "dist/index.js", "--http"]
