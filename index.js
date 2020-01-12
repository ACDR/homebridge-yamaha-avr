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
function YamahaAVRAccessory(log, config, yamaha) {
  this.log = log;

  // Configuration
  this.YAMAHA = yamaha;
  this.config = config;
  this.sysConfig = null;
  this.name = config.name || 'Yamaha AVR';
  this.inputs = [];
  this.enabledServices = [];
  this.inputServices = [];
  this.playing = true;

  this.setConfig();
  this.setInputs();

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
    callback([
      new YamahaAVRAccessory(
        this.log,
        this.config,
        this.YAMAHA,
      ),
    ]);
  },
};

YamahaAVRAccessory.prototype = {
  /* Services */
  getServices() {
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
      .setCharacteristic(Characteristic.Model, this.sysConfig ? this.sysConfig.YAMAHA_AV.System[0].Config[0].Model_Name[0] : 'Unknown')
      .setCharacteristic(Characteristic.SerialNumber, this.sysConfig ? this.sysConfig.YAMAHA_AV.System[0].Config[0].System_ID[0] : 'Unknown');

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
      this.tvSpeakerService = new Service.TelevisionSpeaker(`${this.name} AVR`, 'tvSpeakerService');
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
    for (let i = 0; i < 50; i++) {
      const inputService = new Service.InputSource(i, `inputSource_${i}`);

      inputService
        .setCharacteristic(Characteristic.Identifier, i)
        .setCharacteristic(Characteristic.ConfiguredName, `Input ${i < 9 ? `0${i + 1}` : i + 1}`)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.NOT_CONFIGURED)
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
        .setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.HIDDEN);

      inputService
        .getCharacteristic(Characteristic.ConfiguredName)
        .on('set', (value, callback) => {
          callback(null, value);
        });

      this.tvService.addLinkedService(inputService);
      this.inputServices.push(inputService);
      this.enabledServices.push(inputService);
    }
  },

  /* State Handlers */
  checkAVRState(callback) {
    this.getPowerState(callback);
  },

  updateAVRState(error, status) {
    this.setConfig();
    this.setInputs();

    if (this.tvService) {
      this.tvService.getCharacteristic(Characteristic.Active).updateValue(status);

      if (status) {
        this.YAMAHA.getBasicInfo().done((basicInfo) => {
          this.inputs.filter((input, index) => {
            if (input.id === basicInfo.getCurrentInput()) {
              // Get and update homekit accessory with the current set input
              if (this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).value !== index) {
                this.log(`Updating input from ${input.name} to ${input.name}`);
                return this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(index);
              }
            }

            return null;
          });
        });
      }
    }
  },

  setConfig() {
    this.YAMAHA.getSystemConfig().then(
      sysConfig => {
        if (sysConfig) {
          this.sysConfig = sysConfig;
          this.informationService.getCharacteristic(Characteristic.Model).updateValue(this.sysConfig.YAMAHA_AV.System[0].Config[0].Model_Name[0]);
          this.informationService.getCharacteristic(Characteristic.SerialNumber).updateValue(this.sysConfig.YAMAHA_AV.System[0].Config[0].System_ID[0]);
        }
      },
      error => {
        this.log(`Failed to get system config from ${this.config.name}. Please verify the AVR is connected and accessible at ${this.config.ip}`);
      }
    );
  },

  setInputs() {
    if (this.sysConfig) {
      this.YAMAHA.getAvailableInputsWithNames().then(
        availableInputs => {
          const sanitizedInputs = [];

          let i = 0;

          for (const key in availableInputs[0]) {
            // check if the property/key is defined in the object itself, not in parent
            if (availableInputs[0].hasOwnProperty(key)) {
              const id = String(key).replace('_', '');
              const input = {
                id: id,
                name: availableInputs[0][key][0],
                index: i
              };
              sanitizedInputs.push(input);
              i++;
            }
          }

          this.inputs = sanitizedInputs;

          if (this.config.inputs && this.config.inputs.length > 0) {
            const filteredInputs = [];

            this.config.inputs.forEach((input, i) => {
              sanitizedInputs.forEach(sanitizedInput => {
                if (sanitizedInput.id === input.id) {
                  input.index = i;
                  filteredInputs.push(input);
                }
              });
            });

            this.inputs = filteredInputs;
          }

          this.inputs.forEach((input, i) => {
            const inputService = this.inputServices[i];
            inputService.getCharacteristic(Characteristic.ConfiguredName).updateValue(input.name);
            inputService.getCharacteristic(Characteristic.IsConfigured).updateValue(Characteristic.IsConfigured.CONFIGURED);
            inputService.getCharacteristic(Characteristic.CurrentVisibilityState).updateValue(Characteristic.CurrentVisibilityState.SHOWN);
          });
        },
        error => {
          this.log(`Failed to get available inputs from ${this.config.name}. Please verify the AVR is connected and accessible at ${this.config.ip}`);
        }
      );
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
