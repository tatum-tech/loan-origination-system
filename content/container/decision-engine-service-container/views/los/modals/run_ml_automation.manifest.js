'use strict';
const moment = require('moment');
const pluralize = require('pluralize');
const utilities = require('../../../utilities');
const styles = utilities.views.constants.styles;
const randomKey = Math.random;

module.exports = {
  'containers': {
    '/los/applications/:id/run_automation/ml/:mlmodel': {
      layout: {
        privileges: [ 101, 102, 103 ],
        component: 'Container',
        props: {},
        asyncprops: {
          _children: ['docdata', '_children'],
        },
      },
      'resources': {
        docdata: '/los/api/applications/:id/run_automation/ml/:mlmodel',
        checkdata: {
          url: '/auth/run_checks',
          options: {
            onSuccess: [ 'func:window.redirect', ],
            onError: [ 'func:this.props.logoutUser', 'func:window.redirect', ],
            blocking: true,
            renderOnError: false,
          },
        },
      },
      callbacks: [ 'func:window.setHeaders', ],
      'onFinish': 'render',
    },
  },
};