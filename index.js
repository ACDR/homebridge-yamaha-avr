const YamahaAPI = require('yamaha-nodejs');
const fetch = require('node-fetch');
// https://github.com/christianfl/av-receiver-docs/

let Service;
let Characteristic;

// --== MAIN SETUP ==--
function YamahaAVRPlatform(log, config) {
  this.log = log;
  this.config = config;

  // create the Yamaha API instance
  this.YAMAHA = new YamahaAPI(config.ip);
}

/* Initialise Yamaha AVR Accessory */
function YamahaAVRAccessory(log, config, yamaha, sysConfig, inputs) {
  this.log = log;

  // Configuration
  this.YAMAHA = yamaha;
  this.config = config;
  this.sysConfig = sysConfig;
  this.name = config.name || 'Yamaha AVR';
  this.inputs = inputs;
  this.enabledServices = [];
  this.playing = true;

  // Check & Update Accessory Status every 5 seconds
  this.checkStateInterval = setInterval(
    this.checkAVRState.bind(this, this.updateAVRState.bind(this)),
    5000,
  );
}

module.exports = (homebridge) => {
  ({ Service, Characteristic } = homebridge.hap);
  homebridge.registerPlatform('homebridge-yamaha-avr', 'yamaha-avr', YamahaAVRPlatform);
};

YamahaAVRPlatform.prototype = {
  accessories(callback) {
    // Get Yamaha System Configuration
    this.YAMAHA.getSystemConfig().then(
      (sysConfig) => {
        if (sysConfig && sysConfig.YAMAHA_AV) {
          // Create the Yamaha AVR Accessory
          if (this.config.inputs) {
            callback([
              new YamahaAVRAccessory(
                this.log,
                this.config,
                this.YAMAHA,
                sysConfig,
                this.config.inputs,
              ),
            ]);
          } else {
            // If no inputs defined in config - set available inputs as returned from receiver
            this.YAMAHA.getAvailableInputs().then((availableInputs) => {
              callback([
                new YamahaAVRAccessory(
                  this.log,
                  this.config,
                  this.YAMAHA,
                  sysConfig,
                  availableInputs,
                ),
              ]);
            });
          }
        }
      },
      (ERROR) => {
        this.log(`ERROR: Failed getSystemConfig from ${this.config.name} probably just not a Yamaha AVR.`, ERROR);
      },
    );
  },
};

YamahaAVRAccessory.prototype = {
  /* Services */
  getServices() {
    this.log(`Initialised ${this.name}`);

    // Services
    this.informationService();
    this.televisionService();
    this.televisionSpeakerService();
    this.inputSourceServices();

    return this.enabledServices;
  },

  informationService() {
    // Create Information Service
    this.informationService = new Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Manufacturer, 'Yamaha')
      // .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version)
      .setCharacteristic(Characteristic.Model, this.sysConfig.YAMAHA_AV.System[0].Config[0].Model_Name[0])
      .setCharacteristic(Characteristic.SerialNumber, this.sysConfig.YAMAHA_AV.System[0].Config[0].System_ID[0]);

    this.enabledServices.push(this.informationService);
  },

  televisionService() {
    // Create Television Service (AVR)
    this.tvService = new Service.Television(this.name, 'tvService');

    this.tvService
      .setCharacteristic(Characteristic.ConfiguredName, this.name)
      .setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

    this.tvService
      .getCharacteristic(Characteristic.Active)
      .on('get', this.getPowerState.bind(this))
      .on('set', this.setPowerState.bind(this));

    this.tvService
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .on('get', this.getInputState.bind(this))
      .on('set', (inputIdentifier, callback) => {
        this.setInputState(this.inputs[inputIdentifier], callback);
      });

    this.tvService
      .getCharacteristic(Characteristic.RemoteKey)
      .on('set', this.remoteKeyPress.bind(this));

    this.enabledServices.push(this.tvService);
  },

  televisionSpeakerService() {
    this.tvSpeakerService = new Service.TelevisionSpeaker(`${this.name} Volume`, 'tvSpeakerService');
    this.tvSpeakerService
      .setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
      .setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE);

    this.tvSpeakerService
      .getCharacteristic(Characteristic.VolumeSelector)
      .on('set', (direction, callback) => {
        this.setVolume(direction, callback);
      });

    this.tvService.addLinkedService(this.tvSpeakerService);
    this.enabledServices.push(this.tvSpeakerService);
  },

  inputSourceServices() {
    this.inputs.forEach((input, i) => {
      const inputService = new Service.InputSource(input.id, `inputSource${i}`);

      inputService
        .setCharacteristic(Characteristic.Identifier, i)
        .setCharacteristic(Characteristic.ConfiguredName, input.name)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
        .setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN);

      inputService
        .getCharacteristic(Characteristic.ConfiguredName)
        .on('set', (value, callback) => {
          callback();
        });

      this.tvService.addLinkedService(inputService);
      this.enabledServices.push(inputService);
    });
  },

  /* State Handlers */
  checkAVRState(callback) {
    this.getPowerState(callback);
  },

  updateAVRState(error, status) {
    if (this.tvService) {
      this.tvService.getCharacteristic(Characteristic.Active).updateValue(status);

      if (status) {
        this.YAMAHA.getBasicInfo().done((basicInfo) => {
          this.inputs.filter((input, index) => {
            if (input.id === basicInfo.getCurrentInput()) {
              // Get and update homekit accessory with the current set input
              if (this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).value !== index) {
                this.log('Updating input', input.name, input.id);
                return this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(index);
              }
            }

            return null;
          });
        });
      }
    }
  },

  getPowerState(callback) {
    this.YAMAHA.isOn().then(
      (RESULT) => {
        callback(null, RESULT);
      },
      (ERROR) => {
        callback(ERROR, false);
      },
    );
  },

  setPowerState(state, callback) {
    if (state) {
      this.log('Power On');
      this.YAMAHA.powerOn();
    } else {
      this.log('Power Off');
      this.YAMAHA.powerOff();
    }

    callback();
  },

  setVolume(direction, callback) {
    this.YAMAHA.getBasicInfo().done((basicInfo) => {
      const volume = basicInfo.getVolume();

      if (direction === 0) {
        this.log('Volume Up', (volume + 5) / 10);
        this.YAMAHA.volumeUp(5);
      } else {
        this.log('Volume Down', (volume - 5) / 10);
        this.YAMAHA.volumeDown(5);
      }

      callback();
    });
  },

  getInputState(callback) {
    this.YAMAHA.getBasicInfo().done((basicInfo) => {
      this.inputs.filter((input, index) => {
        if (input.id === basicInfo.getCurrentInput()) {
          this.log(`Current Input: ${input.name}`, index);
          return callback(null, index);
        }

        return null;
      });
    });
  },

  setInputState(input, callback) {
    this.log(`Set input: ${input.name} (${input.id})`);
    this.YAMAHA.setInputTo(input.id);
    callback();
  },

  sendRemoteCode(remoteKey, callback) {
    fetch(`http://${this.config.ip}/YamahaExtendedControl/v1/system/sendIrCode?code=${remoteKey}`).then((RESPONSE) => {
      callback(RESPONSE);
    });
  },

  remoteKeyPress(remoteKey, callback) {
    switch (remoteKey) {
      case Characteristic.RemoteKey.REWIND:
        this.YAMAHA.rewind();
        callback();
        break;
      case Characteristic.RemoteKey.FAST_FORWARD:
        this.YAMAHA.skip();
        callback();
        break;
      case Characteristic.RemoteKey.NEXT_TRACK:
        this.sendRemoteCode('7F016D92', callback);
        break;
      case Characteristic.RemoteKey.PREVIOUS_TRACK:
        this.sendRemoteCode('7F016C93', callback);
        break;
      case Characteristic.RemoteKey.ARROW_UP:
        this.sendRemoteCode('7A859D62', callback);
        break;
      case Characteristic.RemoteKey.ARROW_DOWN:
        this.sendRemoteCode('7A859C63', callback);
        break;
      case Characteristic.RemoteKey.ARROW_LEFT:
        this.sendRemoteCode('7A859F60', callback);
        break;
      case Characteristic.RemoteKey.ARROW_RIGHT:
        this.sendRemoteCode('7A859E61', callback);
        break;
      case Characteristic.RemoteKey.SELECT:
        this.sendRemoteCode('7A85DE21', callback);
        break;
      case Characteristic.RemoteKey.BACK:
        this.sendRemoteCode('7A85AA55', callback);
        break;
      case Characteristic.RemoteKey.EXIT:
        this.sendRemoteCode('7A85AA55', callback);
        break;
      case Characteristic.RemoteKey.PLAY_PAUSE:
        if (this.playing) {
          this.YAMAHA.pause();
          // this.sendRemoteCode('7F016798', callback);
        } else {
          this.YAMAHA.play();
          // this.sendRemoteCode('7F016897', callback);
        }

        this.playing = !this.playing;

        callback();

        break;
      case Characteristic.RemoteKey.INFORMATION:
        // Next Input
        this.sendRemoteCode('7A851F60', callback);

        break;
      default:
        callback();
        break;
    }
  },
};
