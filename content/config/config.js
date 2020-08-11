'use strict';

module.exports = require('@digifi/app-config-loader');


//  *-------SQL CONFIGURATION DB --------
//  *-------ENVIRONMENT VARIABLES --------
//  *'use strict';
const minimist = require('minimist');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const flatten = require('flat');
const defaultConfig = {
  'configuration': {
    'type': 'db',
    'db': 'mongoose',
    'options': {
      'url': 'mongodb://localhost:27017/config_db',
      'connection_options': {},
    },
  },
  settings: {
    name: 'Sample App',
  },
};

function appConfig(customProcess){
  return new Promise((resolve, reject)=>{
    try {
      let useableProcess = customProcess || process;
      let cli_config = minimist(useableProcess.argv.slice(2));
      let env_filepath = (cli_config.envOptions && cli_config.envOptions.path)
        ? cli_config.envOptions.path
        : path.join(process.cwd(), '.env');
      let appConfig = Object.assign({}, defaultConfig);
      if (cli_config.db_config) {
        appConfig = flatten.unflatten(Object.assign({}, flatten(defaultConfig), flatten(cli_config.db_config)));
      } else if (fs.existsSync(env_filepath)){
        let envOptions = (cli_config.envOptions)
          ? cli_config.envOptions
          : {};
        dotenv.config(envOptions);
        let env_config = JSON.parse(process.env.DB_CONFIG);
        appConfig = flatten.unflatten(Object.assign({}, flatten(defaultConfig), flatten(env_config)));
      } 
      return resolve(appConfig); 
    } catch(e){
      return reject(e);
    }
  }); 
}
module.exports = appConfig;

