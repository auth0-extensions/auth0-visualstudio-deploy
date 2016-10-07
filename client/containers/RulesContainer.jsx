import React, { PropTypes, Component } from 'react';
import connectContainer from 'redux-static';

import { ruleActions } from '../actions';

import { Error, LoadingPanel } from '../components/Dashboard';
import RulesTable from '../components/RulesTable';

export default connectContainer(class extends Component {
  static stateToProps = (state) => ({
    rules: state.rules.get('records'),
    showNotification: state.rules.get('showNotification'),
    notificationType: state.rules.get('notificationType')
  });

  static actionsToProps = {
    ...ruleActions
  }

  static propTypes = {
    rules: PropTypes.object.isRequired,
    fetchAllRules: PropTypes.func.isRequired,
    updateRules: PropTypes.func.isRequired,
    openNotification: PropTypes.func.isRequired,
    closeNotification: PropTypes.func.isRequired,
    showNotification: PropTypes.func.isRequired,
    notificationType: PropTypes.func.isRequired
  }

  componentWillMount() {
    this.props.fetchAllRules();
  }

  render() {
    const error = null;
    const loading = false;
    const rules = this.props.rules;
    return (
      <div>
        <LoadingPanel show={loading} animationStyle={{ paddingTop: '5px', paddingBottom: '5px' }}>
          <div className="row">
            <div className="col-xs-12">
              <Error message={error} />
              <RulesTable
                rules={rules}
                loading={loading}
                error={error}
                saveManualRules={this.props.updateRules}
                openNotification={this.props.openNotification}
                closeNotification={this.props.closeNotification}
                showNotification={this.props.showNotification}
                notificationType={this.props.notificationType}
              />
            </div>
          </div>
        </LoadingPanel>
      </div>
    );
  }
});
