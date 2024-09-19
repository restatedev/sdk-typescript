FROM node:20

WORKDIR /usr/src/app

COPY . .

RUN npm install

RUN npm run build

# Install Tini
RUN apt-get update && apt-get -y install tini

EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "/usr/src/app/packages/restate-e2e-services/dist/src/app.js"]
