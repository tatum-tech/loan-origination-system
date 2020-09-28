'use strict';

const TABS = [ {
  label: 'GENERATE RESULTS',
  location: 'run_simulation',
  dropdownType: 'run_simulation',
}, {
  label: 'Cases',
  location: 'test_cases',
  dropdownType: 'test_cases',
}, ];

function getTabComponent(tab, options) {
  return {
    component: 'Tab',
    props: {
      isActive: (tab.location === options.tabname),
      style: {
        textAlign: 'center'
      },
    },
    children: [ {
      component: 'ResponsiveButton',
      asyncprops: {
        onclickPropObject: [ `testcasedata`, ]
      },
      props: {
        onClick: 'func:this.props.reduxRouter.push',
        onclickBaseUrl: `/processing/input/${tab.location}`,
        onclickLinkParams: [ {
          key: ':id',
          val: '_id'
        } ],
        style: {
          border: 'none',
        },
      },
      children: tab.label,
    }, ],
  };
}

function generateComponent(options) {
  let { tabname, } = options;
  return {
    component: 'div',
    props: {
      className: 'global-sub-tabs',
      style: {
        marginBottom: '20px',
        borderBottom: '1px solid #d3d6db',
      }
    },
    children: [ {
      component: 'Container',
      children: [ {
        component: 'Tabs',
        props: {
          tabStyle: 'isBoxed',
          style: {
            marginBottom: '-1px',
            marginTop: '-10px',
          }
        },
        children: [
          {
            component: 'TabGroup',
            children: TABS.map(tab => getTabComponent(tab, options)),
            props: {},
          },
        ]
      } ]
    } ]
  }
};

module.exports = generateComponent;