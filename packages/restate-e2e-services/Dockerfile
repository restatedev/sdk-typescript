FROM node:20 AS build

WORKDIR /usr/src/app

COPY . .

RUN npm install

RUN npm run build

FROM node:20 as prod
WORKDIR /usr/src/app

# Install app dependencies
COPY ./packages/restate-e2e-services/package*.json ./
RUN npm install --production

COPY --from=build /usr/src/app/packages/restate-e2e-services/dist /usr/src/app/dist

# Install Tini
RUN apt-get update && apt-get -y install tini

EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "/usr/src/app/dist/src/app.js"]
