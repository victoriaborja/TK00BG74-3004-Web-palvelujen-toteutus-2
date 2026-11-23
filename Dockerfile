FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server-a.js server-b.js index.html admin.html ./
EXPOSE 3000 3001
CMD ["node", "server-a.js"]
