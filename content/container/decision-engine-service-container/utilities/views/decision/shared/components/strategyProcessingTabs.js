'use strict';
function getTabComponent(tab, tabname) {
  return {
    component: 'Tab',
    props: {
      isActive: (tab.location === tabname),
      style: {
        textAlign: 'center'
      },
    },
    children: [ {
      component: 'ResponsiveButton',
      props: {
        onClick: 'func:this.props.reduxRouter.push',
        onclickBaseUrl: `/decision/processing/${tab.location}/run`,
        style: {
          border: 'none',
        },
      },
      children: tab.label,
    }, ],
  };
}

function generateComponent(tabname, userRole) {

  const PROCESSING_TABS = [ {
    label: 'Individual',
    location: 'individual',
  }, {
    label: 'Batch',
    location: 'batch',
  }, {
    label: 'API Activation',
    location: 'api',
    }, ];
  if (userRole === 'user') PROCESSING_TABS.pop();
  
  return {
    component: 'div',
    props: {
      className: 'global-sub-tabs',
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
            children: PROCESSING_TABS.map(tab => getTabComponent(tab, tabname)),
            props: {},
          },
        ]
      } ]
    } ]
  }
}

module.exports = generateComponent;