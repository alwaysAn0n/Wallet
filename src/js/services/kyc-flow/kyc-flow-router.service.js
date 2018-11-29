'use strict';

(function(){

angular
  .module('bitcoincom.services')
  .factory('kycFlowRouterService', kycFlowRouterService);
  
  function kycFlowRouterService(
    $state, $ionicHistory, $timeout
  ) {

    var service = {
      // Functions
      start: start,
      goNext: goNext,
      goBack: goBack,
    };

    return service;

    /**
     * Start new send flow
     */
    function start(state) {     
      service.goNext(state);
    }

    /**
     * Go to the next page
     * Routing strategy : https://bitcoindotcom.atlassian.net/wiki/spaces/BW/pages/757596161/Buy+bitcoin
     */
    function goNext(state) {
      console.log('kyc-flow-router - goNext');
      var atteptRecovery = (state.recovery)
      var needsNationality = !(state.country && state.doucmentType);
      var needsDocumentation = !( state.documents && state.documents.length >= state.documentPageMinimum);
      var needsPersonalInfo = false;

      // Recover Customer ID Page
      if(atteptRecovery) {
        if(atteptRecovery === 'start') {
          // Recovery page
          console.log('KYC-FLOW - Recovery Page');
          return;
        } else {
          // Recovery Success/Failure Page
          console.log('KYC-FLOW - Recovery Page - Fail/Success');
          return;
        }
      }
      // New Customer Page
      if (needsNationality) {
        console.log('KYC-FLOW - Verification');
        $state.go('tabs.buybitcoin-customer-verification');
        return;
      }

      // Document Photo Page
      if (needsDocumentation) {
        console.log('KYC-FLOW - Document Photo');
        return;
      }

      // Review Document Page
      

      // Personal Info Page
      if (needsPersonalInfo) {
        console.log('KYC-FLOW - Personal Info');
        return;
      }

      // KYC Status Page
      if (state.identity.status !== 'initiated') {
        console.log('KYC-FLOW - KYC Status');
        return;
      }

      // Go to home
      $ionicHistory.clearHistory();
      $state.go('tabs.buy-bitcoin-home');
    }

    /**
     * Go to the previous page
     */
    function goBack() {
      $ionicHistory.goBack();
    }
  };

})();