'use strict';

/** Middleware for files. */

const periodic = require('periodicjs');
const logger = periodic.logger;
const utilities = require('../utilities');
const helpers = utilities.helpers;
const uniqid = require('uniqid');

/**
 * 
 * Creates files for data integrations.
 * @param {any} req Express request object
 * @param {any} res Express response object
 * @param {any} next Express next function
 */
function createFiles(req, res, next) {
  req.controllerData = req.controllerData || {};
  let user = req.user;
  let organization = (user && user.association && user.association.organization && user.association.organization._id) ? user.association.organization._id : 'organization';
  const File = periodic.datas.get('standard_file');
  if (req.controllerData.org && req.controllerData.org.save_data) {
    req.controllerData.creditEngineResponse.forEach(async result => {
      if (result.data_sources && result.data_sources.length) {
        result.data_sources.forEach(async (data_source) => {
          let { name, data, } = data_source;
          let Key, filetype;
          try {
            JSON.parse(data);
            Key = `dataintegrations/api_response_${new Date()}_${uniqid()}/${name.replace(/\//g, '_')}.json`;
            filetype = 'json';
          } catch (e) {
            Key = `dataintegrations/api_response_${new Date()}_${uniqid()}/${name.replace(/\//g, '_')}.xml`;
            filetype = 'xml';
          }
          await helpers.uploadAWS({ Key, Body: data, });
          await File.create({ newdoc: Object.assign({}, { name, fileurl: Key, filetype, organization, user, }), });
        });
      }
    });
  }
  return next();
}

module.exports = {
  createFiles,
};