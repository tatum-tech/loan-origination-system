'use strict';
const capitalize = require('capitalize');
const periodic = require('periodicjs');
const pluralize = require('pluralize');
const utilities = require('../../../../../utilities');
const formConfigs = require('../../../../../utilities/views/decision/shared/components/formConfigs');
const decisionTabs = require('../../../../../utilities/views/decision/shared/components/decisionTabs');
const collectionDetailTabs = require('../../../../../utilities/views/decision/shared/components/collectionDetailTabs');
const detailAsyncHeaderTitle = require('../../../../../utilities/views/shared/component/layoutComponents').detailAsyncHeaderTitle;
const detailHeaderButtons = require('../../../../../utilities/views/decision/shared/components/detailHeaderButtons');
const styles = require('../../../../../utilities/views/constants/styles');
const references = require('../../../../../utilities/views/constants/references');
const CONSTANTS = require('../../../../../utilities/views/decision/constants');
const DATA_TYPES_DROPDOWN = CONSTANTS.DATA_TYPES_DROPDOWN;
const VARIABLE_TYPES_DROPDOWN = CONSTANTS.VARIABLE_TYPES_DROPDOWN;
const commentsModal = require('../../../../../utilities/views/decision/modals/comment');
const cardprops = require('../../../../../utilities/views/decision/shared/components/cardProps');
const formElements = require('../../../../../utilities/views/decision/shared/components/formElements');
const strategyNavBar = require('./strategy_nav_bar');
const randomKey = Math.random;
const formGlobalButtonBar = require('../../../../../utilities/views/shared/component/globalButtonBar').formGlobalButtonBar;
const addPopulationButtons = require('./rule_dropdowns').addPopulationButtons;
const addRuleDropdown = require('./rule_dropdowns').addRuleDropdown;
const THEMESETTINGS = periodic.settings.container[ 'decision-engine-service-container' ];
const settings = {
  title: 'Strategy Detail',
  type: 'strategy',
  location: 'segment',
};

let { validations, hiddenFields, formgroups, additionalComponents, } = formConfigs[ settings.type ].edit;
let pluralizedType = pluralize(settings.type);
let url = '/decision/api/standard_strategies/:id/segments/output/:index?method=editSegment';
let headerButtons = detailHeaderButtons({ type: settings.type, location: settings.location, });


const SEGMENT = [decisionTabs(pluralizedType),
  detailAsyncHeaderTitle({ title: settings.title, type: settings.type, }),
  collectionDetailTabs({ tabname: settings.location, collection: settings.type, }),
  {
    component: 'Container',
    props: {
      style: {
        display: 'flex',
      },
    },
    children: [
      {
        component: 'div',
        children: [strategyNavBar(settings.type),],
      },
      {
        component: 'ResponsiveForm',
        hasWindowFunc: true,
        props: {
          style: {
            flex: '1 1 auto',
          },
          ref: 'func:window.addRef',
          flattenFormData: true,
          footergroups: false,
          useFormOptions: true,
          onChange: 'func:window.checkPopulation',
          onSubmit: {
            url,
            params: [
              { 'key': ':id', 'val': '_id', },
            ],
            options: {
              headers: {
                'Content-Type': 'application/json',
              },
              method: 'PUT',
            },
            successProps: {
              type: 'success',
              text: 'Changes saved successfully!',
              timeout: 10000,
            },
            successCallback: 'func:window.editFormSuccessCallback',
          },
          // validations,
          // hiddenFields: hiddenFields,
          formgroups: [formGlobalButtonBar({
            left: [
            //   {
            //   component: 'ResponsiveButton',
            //   thisprops: {
            //     onclickPropObject: [ 'formdata' ],
            //   },
            //   props: {
            //     onClick: 'func:this.props.createModal',
            //     onclickProps: {
            //       title: 'Add Segment to Strategy',
            //       pathname: `/decision/strategies/:id/add_segment`,
            //       params: [ { key: ':id', val: '_id', }]
            //     },
            //     buttonProps: {
            //       color: 'isSuccess',
            //       className: 'add_segment_button',
            //     },
            //   },
            //   children: 'ADD SEGMENT',
            // }
            ],
            right: [{
              type: 'submit',
              value: 'SAVE',
              layoutProps: {
                size: 'isNarrow',
              },
              passProps: {
                color: 'isPrimary',
              },
            }, {
              guideButton: true,
              location: references.guideLinks.rulesEngine.strategiesDetailRules,
            },],
          }), {
            gridProps: {
              key: randomKey(),
            },
            card: {
              twoColumns: true,
              props: cardprops({
                cardStyle: {
                  marginBottom: 0,
                },
                headerStyle: {
                  display: 'none',
                },
              }),
            },
            formElements: [{
              formGroupElementsLeft: [{
                label: 'Name',
                keyUp: 'func:window.nameOnChange',
                name: 'segment_name',
              },],
              formGroupElementsRight: [{
                label: 'Description',
                name: 'segment_description',
              },],
            },],
          }, {
            gridProps: {
              key: randomKey(),
              className: 'output_rules',
            },
            card: {
              props: cardprops({
                cardTitle: 'Rule-Based Outputs',
                cardProps: {
                  className: 'primary-card-gradient',
                },
                cardStyle: {
                  marginBottom: 0,
                  marginTop: 20,
                },
              }),
            },
            formElements: [
              {
                type: 'layout',
                value: {
                  component: 'p',
                  children: 'This module produces the Output Variables that have been set in the results section for rules that pass.',
                  props: {
                    style: {
                      fontStyle: 'italic',
                      color: styles.colors.gray,
                    },
                  },
                },
              },
              {
                type: 'layout',
                name: 'updated_ruleset',
                value: {
                  component: 'div',
                },
              },
              {
                type: 'dndtable',
                name: 'ruleset',
                hasWindowFunction: true,
                submitOnChange: true,
                handleRowUpdate: 'func:window.handleRowUpdate',
                flattenRowData: true,
                useInputRows: false,
                addNewRows: false,
                passProps: {
                  className: 'dnd-text-table dnd-or',
                  itemHeight: 45,
                },
                ignoreTableHeaders: ['_id',],
                headers: [{
                  label: {
                    component: 'Columns',
                    children: [{
                      component: 'Column',
                      props: {
                        size: 'is5',
                      },
                      children: 'Variable',
                    }, {
                      component: 'Column',
                      props: {
                        size: 'is3',
                      },
                      children: 'Comparison',
                    }, {
                      component: 'Column',
                      props: {
                        size: 'is4',
                      },
                      children: 'Value',
                    }]
                  },
                  sortid: 'combined_value_comparison_property',
                  sortable: false,
                  columnProps: {
                    style: {
                      width: '65%',
                    },
                  },
                }, {
                  label: 'Output (If Rule Passes)',
                  sortid: 'condition_output_display',
                  sortable: false,
                  columnProps: {
                    style: {
                      width: '25%',
                    },
                  },
                }, {
                  label: ' ',
                  sortid: 'buttons',
                  sortable: false,
                  columnProps: {
                    style: {
                      width: '90px',
                    },
                  },
                },],
              },
              {
                type: 'layout',
                layoutProps: {
                  size: 'isNarrow',
                  style: {
                    display: 'inline-flex',
                    height: '55px',
                    alignItems: 'center',
                  },
                },
                value: addRuleDropdown([{
                  name: 'CREATE NEW',
                  onclickProps: {
                    title: 'Create New Rule-Based Output',
                    pathname: '/decision/strategies/:id/output/create/init',
                    params: [{ key: ':id', val: '_id', },],
                  },
                }, {
                  name: 'COPY EXISTING',
                  onclickProps: {
                    title: 'Copy Existing Output Set',
                    pathname: '/decision/strategies/:id/output/copy',
                    params: [{ key: ':id', val: '_id', },],
                  },
                }, {
                  name: 'UPLOAD CSV',
                  onclickProps: {
                    title: 'Upload Rule-Based Output Segment',
                    pathname: '/modal/decision/upload_csv_segment/outputs',
                    params: [{ key: ':id', val: '_id', },],
                  },
                  passProps: {
                    style: {
                      display: (THEMESETTINGS.advanced_ruleset_upload) ? '' : 'none',
                    },
                  },
                },], 'ADD OUTPUT'),
              }, {
                type: 'Semantic.checkbox',
                label: 'Apply these outputs to a specific population',
                passProps: {
                  className: 'reverse-label',
                },
                layoutProps: {
                  size: 'isNarrow',
                  style: {
                    display: 'inline-flex',
                    height: '55px',
                    float: 'right',
                    alignItems: 'center',
                  },
                },
                name: 'has_population',
              },],
          }, {
            gridProps: {
              key: randomKey(),
              className: 'population_rules',
            },
            card: {
              props: cardprops({
                cardTitle: 'Population Rules',
                cardProps: {
                  className: 'primary-card-gradient',
                },
                cardStyle: {
                  marginBottom: 0,
                },
              }),
            },
            formElements: [
              {
                type: 'layout',
                name: 'updated_conditions',
                value: {
                  component: 'div',
                },
              },
              {
                type: 'dndtable',
                name: 'conditions',
                hasWindowFunction: true,
                submitOnChange: true,
                handleRowUpdate: 'func:window.handleRowUpdate',
                flattenRowData: true,
                useInputRows: false,
                addNewRows: false,
                passProps: {
                  itemHeight: 45,
                  className: 'dnd-text-table dnd-and',
                },
                ignoreTableHeaders: ['_id',],
                headers: [{
                  label: {
                    component: 'Columns',
                    children: [{
                      component: 'Column',
                      props: {
                        size: 'is5',
                      },
                      children: 'Variable',
                    }, {
                      component: 'Column',
                      props: {
                        size: 'is3',
                      },
                      children: 'Comparison',
                    }, {
                      component: 'Column',
                      props: {
                        size: 'is4',
                      },
                      children: 'Value',
                    }]
                  },
                  sortid: 'combined_value_comparison_property',
                  sortable: false,
                }, {
                  label: ' ',
                  sortid: 'buttons',
                  sortable: false,
                  columnProps: {
                    style: {
                      width: '90px',
                    },
                  },
                },],
              }, {
                type: 'layout',
                value: addPopulationButtons(),
              },],
          },],
        },
        asyncprops: {
          formdata: [`${settings.type}data`, 'data',],
          __formOptions: [`${settings.type}data`, 'formsettings',],
        },
      },],
  },];

module.exports = SEGMENT;
