# Usually to select particular version instead of latest
FROM node:11.7.0 as base

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . /usr/src/app

# Install production dependencies
RUN export NODE_ENV=development && npm i && npm i periodicjs.ext.passport --save && npm i periodicjs.ext.oauth2server@10.5.21 --save

COPY . .

# Expose port for access outside of container
EXPOSE 8786 8787 8788 80 443 22 27017

CMD ["npm", "start", "development"]