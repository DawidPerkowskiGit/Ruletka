FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY engine/package.json engine/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --include=dev
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
