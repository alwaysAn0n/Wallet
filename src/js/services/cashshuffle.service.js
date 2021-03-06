// 'use strict';

// (function(){

angular
.module('bitcoincom.services')
.service('cashshuffleService', [
  '$rootScope',
  'profileService',
  'ongoingProcess',
  'configService',
  'walletService',
  'walletHistoryService',
  'walletAddressListenerService',
  'pushNotificationsService',
  'lodash',
  '$timeout',
  '$q',
  '$state',
  'soundService',
  'cashshuffleCoinFactory',
  function cashshuffleService(
    $rootScope,
    profileService,
    ongoingProcess,
    configService,
    walletService,
    walletHistoryService,
    walletAddressListenerService,
    pushNotificationsService,
    _,
    $timeout,
    $q,
    $state,
    soundService,
    cashshuffleCoinFactory) {

      const defaultServerStatsUri = 'https://shuffle.servo.cash:8080/stats';

      // Function called by the CashShuffle library which returns an
      // empty address to store change from the shuffle transaction.
      const getChangeAddress = function getChangeAddress(unshuffledCoinDetails) {
        return new Promise((resolve, reject) => {

          let grabWallet = _.find(profileService.getWallets({ coin: 'bch' }), { id: unshuffledCoinDetails.walletId });

          let walletHdMaster = grabWallet.credentials.getDerivedXPrivKey();

          walletService.getAddress(grabWallet, false, (err, someLegacyAddress) => {
            if (err) {
              return reject(err);
            }

            walletService.getAddressObj(grabWallet, someLegacyAddress, (err, someAddressObject) => {
              if (err) {
                return reject(err);
              }

              let pieces = someAddressObject.path.split('/');
              let newAddressPath = pieces[0]+'/1/'+pieces[2];

              let coinPrivateKey = walletHdMaster.derive(newAddressPath).privateKey;

              let oneCoin = {};

              oneCoin.path = newAddressPath;
              oneCoin.publicKey = coinPrivateKey.toPublicKey();
              oneCoin.legacyAddress = oneCoin.publicKey.toAddress().toString();
              oneCoin.privateKeyWif = coinPrivateKey.toWIF();
              oneCoin.walletId = grabWallet.id;
              oneCoin.walletName = grabWallet.name;
              oneCoin.wallet = grabWallet;

              return resolve(oneCoin);

            });
          });

        });

      };

      // Function called by the CashShuffle library which returns an
      // empty address to store a freshly shuffled coin.
      const getShuffledAddress = function getShuffledAddress(unshuffledCoinDetails) {
        return new Promise((resolve, reject) => {

          let grabWallet = _.find(profileService.getWallets({ coin: 'bch' }), { name: 'CashShuffle Spending Wallet' });

          let walletHdMaster = grabWallet.credentials.getDerivedXPrivKey();

          walletService.getAddress(grabWallet, false, (err, someLegacyAddress) => {
            if (err) {
              return reject(err);
            }

            walletService.getAddressObj(grabWallet, someLegacyAddress, (err, someAddressObject) => {
              if (err) {
                return reject(err);
              }

              let coinPrivateKey = walletHdMaster.derive(someAddressObject.path).privateKey;

              let oneCoin = {};

              oneCoin.path = someAddressObject.path
              oneCoin.publicKey = coinPrivateKey.toPublicKey();
              oneCoin.legacyAddress = oneCoin.publicKey.toAddress().toString();
              oneCoin.privateKeyWif = coinPrivateKey.toWIF();
              oneCoin.walletId = grabWallet.id;
              oneCoin.walletName = grabWallet.name;
              oneCoin.wallet = grabWallet;

              console.log('Got shuffle address:', oneCoin);

              return resolve(oneCoin);

            });
          }, false);

        });

      };

      function CoinShuffleService(properties) {
        _.extend(this, properties);

        // Set a promise that resolves onces the ShuffleClient
        // has been instantiated.  This is watched by the 
        // CashShuffleCoin instances so they know when it's
        // safe to bind the ShuffleClient to themselves.
        const i = $q.defer();
        this.serviceReady = i.promise;

        this.client = undefined;
        this.coinFactory = new cashshuffleCoinFactory(this);

        this.preferences = {
          shufflingEnabled: false,
          autoShuffle: false,
          spendOnlyShuffled: false,
          serverStatsUri: defaultServerStatsUri,
          preferencesLoading: true
        };

        this
        .fetchPreferences()
        .then(() => {

          this
          .coinFactory
          .serviceReady
          .catch((someError) => {
            console.log('An error has occured', someError);
            i.reject(someError);
          })
          .then(() => {
            console.log('The CoinFactory service is ready:', this.coinFactory.coins);

            this
            .registerClient()
            .then(() => {
              console.log('The CashShuffle service is ready and the ShuffleClient is registered!');
              setTimeout(() => {
                $rootScope.$emit('cashshuffle-update');
              }, 500);
              i.resolve(this);
            })
            .catch((someError) => {
              i.reject(someError);
            });

          });

        });

        _.extend(this, {
          update: this.coinFactory.update,
          coins: this.coinFactory.coins
        });

        this.defaultServerStatsUri = defaultServerStatsUri;

        return this;
      };

      CoinShuffleService.prototype.fetchPreferences = function() {

        return new Promise((resolve, reject) => {
          configService.get( (err, currentWalletConfig) => {
            if (err) {
              return reject(err);
            }

            let currentCashShuffleConfig = currentWalletConfig && currentWalletConfig.cashshuffle || {};

            _.extend(this.preferences, {
              shufflingEnabled: currentCashShuffleConfig.shufflingEnabled || false,
              autoShuffle: currentCashShuffleConfig.autoShuffle || false,
              spendOnlyShuffled: currentCashShuffleConfig.spendOnlyShuffled || false,
              serverStatsUri: currentCashShuffleConfig.serverStatsUri || defaultServerStatsUri,
              preferencesLoading: false
            });

            setTimeout(() => {
              $rootScope.$emit('cashshuffle-update');
            }, 500);

            return resolve();

          });

        });

      };

      CoinShuffleService.prototype.registerClient = function() {
        return new Promise((resolve, reject) => {

          this.client = new ShuffleClient({
            coins: _.filter(this.coinFactory.coins, { shuffleThisCoin: true }),
            hooks: {
              change: getChangeAddress,
              shuffled: getShuffledAddress
            },
            protocolVersion: 300,
            maxShuffleRounds: 5,
            // Disable automatically joining shuffle rounds
            // once a connection with the server is established
            disableAutoShuffle: !this.preferences.autoShuffle,
            serverStatsUri: this.preferences.serverStatsUri
          });

          this.client.on('phase', (someData) => {

            let coinInQuestion = _.find(this.coinFactory.coins, { txid: someData.round.coin.txid, vout: someData.round.coin.vout });

            if (coinInQuestion) {
              console.log('Got a phase message concerning', coinInQuestion.txid,':',coinInQuestion.vout,'in phase', someData.round.phase);
            }
            else {
              console.log('Got a phase message about a coin we couldnt find:', roundData.round);
              return;
            }

            return coinInQuestion.update({
              playersInRound: someData.round.numberOfPlayers ? someData.round.numberOfPlayers : 1,
              shufflePhase: someData.round.phase,
              inShufflePool: true
            });

          });

          this.client.on('message', (someData) => {

            let coinInQuestion = _.find(this.coinFactory.coins, { txid: someData.round.coin.txid, vout: someData.round.coin.vout });

            if (coinInQuestion) {
              console.log('Got a protocol message concerning', coinInQuestion.txid,':',coinInQuestion.vout,'in phase', someData);
            }
            else {
              console.log('Got a protocol message concerning a coin we couldnt find:', someData);
              return;
            }

            return coinInQuestion.update({
              playersInRound: someData.round.numberOfPlayers ? someData.round.numberOfPlayers : 1,
              shufflePhase: someData.round.phase,
              inShufflePool: true
            });

          });

          this.client.on('abort', (roundData) => {

            let coinInQuestion = _.find(this.coinFactory.coins, { txid: roundData.coin.txid, vout: roundData.coin.vout });

            if (coinInQuestion) {
              console.log('The user has aborted a shuffle for coin', coinInQuestion.txid, ':', coinInQuestion.vout,' ==>', roundData);
            }

            return coinInQuestion.update({
              shuffleThisCoin: false,
              shufflePhase: undefined,
              playersInRound: undefined,
              inShufflePool: false
            });

          });

          this.client.on('failed', (roundData) => {
            let coinInQuestion = _.find(this.coinFactory.coins, { txid: roundData.coin.txid, vout: roundData.coin.vout });

            if (coinInQuestion) {
              console.log('Got a failed shuffle event concerning', coinInQuestion.txid, ':', coinInQuestion.vout,':', roundData);
            }
            else {
              return;
            }

            if (this.preferences.autoShuffle) {

              const tryAgain = () => {
                if (!coinInQuestion.shuffleThisCoin) {
                  console.log('Retrying coin', coinInQuestion);
                  coinInQuestion.update({
                    shuffleThisCoin: true
                  });
                }
              };

              $timeout(tryAgain, 1000 *5);
            }

            return coinInQuestion.update({
              shuffleThisCoin: false,
              playersInRound: undefined,
              shufflePhase: '',
              inShufflePool: false
            });

          });

          this.client.on('shuffle', (roundData) => {
            let coinInQuestion = _.find(this.coinFactory.coins, { txid: roundData.coin.txid, vout: roundData.coin.vout });

            if (!coinInQuestion) {
              return;
            }

            coinInQuestion.update({
              shuffleThisCoin: false,
              playersInRound: roundData.numberOfPlayers ? roundData.numberOfPlayers : 1,
              shufflePhase: '',
              inShufflePool: false
            });

            soundService.play('misc/payment_received.mp3');

            // Scan for new wallet addresses (including our change address)
            walletService.startScan(roundData.coin.wallet, () => {
              walletService.startScan(roundData.shuffled.wallet, () => {

                // Update our transaction history for all wallets involved
                let cashShuffleWallet = _.find(profileService.getWallets(), { name: 'CashShuffle Spending Wallet'});
                walletHistoryService.updateLocalTxHistoryByPage(roundData.coin.wallet, true, false, (err, transactionHistory) => {
                  walletHistoryService.updateLocalTxHistoryByPage(cashShuffleWallet, true, false, (err, transactionHistory) => {

                    this
                    .coinFactory
                    .update()
                    .then(()=>{
                      console.log('Coins Updated!');

                    })
                    .catch(console.log);

                  });
                });
              });
            });
          });

          $rootScope.$on('bwsEvent', (event, walletId) => {
            let wallet = profileService.getWallet(walletId);
            if (wallet.coin === 'bch') {
              this
              .coinFactory
              .update()
              .then(() => {
                $timeout(() => {
                  $rootScope.$emit('cashshuffle-update');
                }, 1000);
              })
              .catch(console.log);
            }
          });

          $rootScope.$on('Local/TxAction', (event, walletId) => {
            let wallet = profileService.getWallet(walletId);
            if (wallet.coin === 'bch') {
              this
              .coinFactory
              .update()
              .then(() => {
                $timeout(() => {
                  $rootScope.$emit('cashshuffle-update');
                }, 1000);
              })
              .catch(console.log);
            }
          });

          for (let oneEventName of ['skipped', 'phase', 'abort', 'message', 'stats']) {
            this.client.on(oneEventName, () => {
              $rootScope.$emit('cashshuffle-update');
            });
          }

          return resolve(this.client);

        });

      };

      CoinShuffleService.prototype.changeShuffleServer = function(newShuffleStatsUri) {
        console.log('Now setting shuffle server to', newShuffleStatsUri);
        this.preferences.serverStatsUri = newShuffleStatsUri;
        this.updateWalletPreferences(true);
        return this.preferences.serverStatsUri;
      };

      CoinShuffleService.prototype.updateWalletPreferences = function(updateServerStatsUri) {
        console.log('Now updating wallet preferences!', this.preferences);
        _.extend(this.preferences, { preferencesLoading: true });

        let newPreferences = {
          cashshuffle: {
            shufflingEnabled: this.preferences.shufflingEnabled,
            autoShuffle: this.preferences.shufflingEnabled ? this.preferences.autoShuffle : false,
            spendOnlyShuffled: this.preferences.spendOnlyShuffled
          }
        };

        let changeServers = false;
        if (updateServerStatsUri) {
          if (this.preferences.serverStatsUri !== this.client.serverStatsUri) {
            changeServers = true;
          }
          newPreferences.cashshuffle.serverStatsUri = this.preferences.serverStatsUri;
        }

        configService.set(newPreferences, (err) => {
          if (err) $log.debug(err);

          if (changeServers) {
            this
            .client
            .changeShuffleServer(newPreferences.cashshuffle.serverStatsUri)
            .then(() => {
              $rootScope.$emit('cashshuffle-update');
              console.log('Shuffle server updated to', newPreferences.cashshuffle.serverStatsUri);
            })
            .catch(console.log);
          }

          // Reset all coins when settings are changed.
          // Their state will be corrected later based
          // on the new settings.
          for (let oneCoin of this.coinFactory.coins) {
            oneCoin.update({
              shuffleThisCoin: false,
              playersInRound: undefined,
              shufflePhase: '',
              inShufflePool: false
            });
          }

          // Now purge the ShuffleClient's internal coin array.
          while(this.client.coins.length) {
            this.client.coins.pop();
          }

          if (!newPreferences.cashshuffle.shufflingEnabled) {
            console.log('Closing all active shuffle rounds because CashShuffle is disabled in preferences');
            let activeShuffleRounds = this.client ? this.client.rounds : []; 
            // Kill any active shuffle rounds on the client
            while (activeShuffleRounds.length) {
              let oneRound = this.client.rounds.pop();
              oneRound.abortRound();
              let coinFromFactory = _.find(this.coinFactory.coins, { txid: oneRound.coin.txid, vout: oneRound.coin.vout });
              if (coinFromFactory) {
                coinFromFactory.update({
                  shuffleThisCoin: false,
                  playersInRound: undefined,
                  shufflePhase: '',
                  inShufflePool: false
                });
              }
            }
            this.client.stop(true);

          }
          else {

            if (!this.client.isShuffling) {
              this.client.start();
            }

          }

          this
          .coinFactory
          .update()
          .then(() => {
            $timeout(() => {
              $rootScope.$emit('cashshuffle-update');
            }, 2000);
          })
          .catch(console.log);

        });

        function createCashShuffleWallet() {
          let allWallets = profileService.getWallets({ coin: 'bch' });

          let cashShuffleWallet = _.find(allWallets, { name: 'CashShuffle Spending Wallet'});

          if (!cashShuffleWallet) {
            console.log('No cashshuffle wallet.  Creating one!!!!');

            var walletOptions = {
              name: 'CashShuffle Spending Wallet',
              m: 1,
              n: 1,
              myName: null,
              networkName: 'livenet',
              bwsurl: 'https://bwscash.bitcoin.com/bws/api',
              coin: 'bch',
              passphrase: null
            };

            ongoingProcess.set('creatingWallet', true);
            $timeout(function() {

              profileService.createWallet(walletOptions, (err, client) => {
                ongoingProcess.set('creatingWallet', false);

                ongoingProcess.set('generatingNewAddress', true);
                walletService.getAddress(client, true, (e, addr) => {
                  ongoingProcess.set('generatingNewAddress', false);

                  walletService.updateRemotePreferences(client);
                  pushNotificationsService.updateSubscription(client);

                  if (!client.isComplete()) {
                    console.log('The client is not complete :(');
                  }
                  else {
                    console.log('The client is complete!');
                  }

                });

              });

            }, 300);

          }
          else {
            console.log('We already have a cashshuffle wallet!', cashShuffleWallet);
          }

        };

        if (this.preferences.shufflingEnabled) {
          createCashShuffleWallet();
        }

        this
        .fetchPreferences()
        .then(() => {
          _.extend(this.preferences, { preferencesLoading: false });
          $rootScope.$emit('cashshuffle-update');
        })
        .catch((someError) => {
          return $log.debug(someError)
        });

        return this.preferences;
      };

      const service = new CoinShuffleService({});

      window.cashshuffleService = service;
      return service;
    }
]);

// )();