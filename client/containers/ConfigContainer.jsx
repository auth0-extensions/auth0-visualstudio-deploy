import React, { PropTypes, Component } from 'react';
import connectContainer from 'redux-static';

import { configActions } from '../actions';
import { Error } from '../components/Dashboard';

import Help from '../components/Help';
import WebhookSettings from '../components/WebhookSettings';
import NotificationDialog from '../components/NotificationDialog';

export default connectContainer(class extends Component {
  static stateToProps = (state) => ({
    config: state.config
  });

  static actionsToProps = {
    ...configActions
  }

  static propTypes = {
    config: PropTypes.object.isRequired,
    fetchConfiguration: PropTypes.func.isRequired,
    showNotification: PropTypes.bool,
    closeNotification: PropTypes.func.isRequired,
    confirmNotification: PropTypes.func.isRequired
  }

  componentWillMount() {
    this.props.fetchConfiguration();
  }

  render() {
    const { error, record, showNotification } = this.props.config.toJS();

    return (
      <div>
        <NotificationDialog
          show={showNotification}
          onClose={this.props.closeNotification}
          onConfirm={this.props.confirmNotification}
        />
        <div className="row">
          <div className="col-xs-12">
            <Error message={error} />
            <WebhookSettings secret={record.secret} payloadUrl={`${window.config.BASE_URL}/webhooks/deploy`} repository={record.repository} branch={record.branch} prefix={record.prefix} />
          </div>
        </div>
        <div className="row">
          <div className="col-xs-12">
            <Help />
          </div>
        </div>
      </div>
    );
  }
});
