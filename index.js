const YamahaAPI = require('yamaha-nodejs');
// https://github.com/christianfl/av-receiver-docs/

let Service;
let Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerPlatform('homebridge-yamaha-avr', 'yamaha-avr', YamahaAVRPlatform);
};

// --== MAIN SETUP ==--
function YamahaAVRPlatform(log, config) {
  this.log = log;
  this.config = config;

  // create the Yamaha API instance
  this.YAMAHA = new YamahaAPI(config['ip']);
}

YamahaAVRPlatform.prototype.accessories = function(callback) {
  // Get Yamaha System Configuration
  this.YAMAHA.getSystemConfig().then(
    (sysConfig) => {
      if (sysConfig && sysConfig.YAMAHA_AV) {
        // Create the Yamaha AVR Accessory
        callback([
          new YamahaAVRAccessory(
            this.log,
            this.config,
            this.YAMAHA,
            sysConfig,
          )
        ]);

        // yamaha.getAvailableInputs().then(
        //   (availableInputs) => {
        //     callback([
        //       new YamahaAVRAccessory(
        //         this.log,
        //         this.config,
        //         this.YAMAHA,
        //         sysConfig,
        //         availableInputs,
        //       );
        //     ]);
        //   }
        // );
      }
    },
    function(error) {
      this.log("DEBUG: Failed getSystemConfig from " + name + ", probably just not a Yamaha AVR.");
    }
  );
}

/* Initialise Yamaha AVR Accessory */
function YamahaAVRAccessory(log, config, yamaha, sysConfig) {
  this.log = log;

  // Configuration
  this.YAMAHA = yamaha;
  this.name = config['name'] || 'Yamaha AVR';
  this.inputs = config['inputs'];
  this.sysConfig = sysConfig;
  this.enabledServices = [];
  this.playing = true;

  // Check & Update Accessory Status every 5 seconds
  this.checkStateInterval = setInterval(
    this.checkAVRState.bind(this, this.updateAVRState.bind(this)
  ), 5000);
}

/* Return Services */
YamahaAVRAccessory.prototype.getServices = function() {
  this.log('Initialised ' + this.name);

  // Services
  this.informationService();
  this.televisionService();
  this.televisionSpeakerService();
  this.inputSourceServices();

  return this.enabledServices;
}

/* Services */
YamahaAVRAccessory.prototype.informationService = function() {
  // Create Information Service
  this.informationService = new Service.AccessoryInformation();
  this.informationService
    .setCharacteristic(Characteristic.Name, this.name)
    .setCharacteristic(Characteristic.Manufacturer, "Yamaha")
    .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version)
    .setCharacteristic(Characteristic.Model, this.sysConfig.YAMAHA_AV.System[0].Config[0].Model_Name[0])
    .setCharacteristic(Characteristic.SerialNumber, this.sysConfig.YAMAHA_AV.System[0].Config[0].System_ID[0]);

  this.enabledServices.push(this.informationService);
};

YamahaAVRAccessory.prototype.televisionService = function() {
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
};

YamahaAVRAccessory.prototype.televisionSpeakerService = function() {
    this.tvSpeakerService = new Service.TelevisionSpeaker(this.name + ' Volume', 'tvSpeakerService');
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
};

YamahaAVRAccessory.prototype.inputSourceServices = function() {
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
          log('CREATED INPUT:', value);
          callback()
      });

    this.tvService.addLinkedService(inputService);
    this.enabledServices.push(inputService);
  });
};

/* Helpers */
YamahaAVRAccessory.prototype.checkAVRState = function(callback) {
  this.YAMAHA.isOn().then(
    (RESULT) =>  {
      callback(null, RESULT);
    },
    function(ERROR) {
      callback(ERROR, false);
    }
  );
};

YamahaAVRAccessory.prototype.updateAVRState = function(error, status) {
  if (status) {
    if (this.tvService) {
      this.tvService.getCharacteristic(Characteristic.Active).updateValue(status);

      this.YAMAHA.getBasicInfo().done(
        (basicInfo) => {
          const input = this.inputs.filter((input, index) => {
            if (input.id == basicInfo.getCurrentInput()) {
              // Get and update homekit accessory with the current set input
              if (this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).value !== index) {
                this.log('Updating input', input.name, input.id);
                this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(index);
              }
            }
          });
        }
      );
    }
  }
};

/* State Handlers */
YamahaAVRAccessory.prototype.getPowerState = function(callback) {
  this.log('Checking power state');

  this.YAMAHA.isOn().then(
    function(RESULT) {
      callback(null, RESULT);
    },
    function(ERROR) {
      callback(ERROR, false);
    }
  );
};

YamahaAVRAccessory.prototype.setPowerState = function(state, callback) {
  if (state) {
    this.log('Power On');
    this.YAMAHA.powerOn();
  } else {
    this.log('Power Off');
    this.YAMAHA.powerOff();
  }

  callback();
};

YamahaAVRAccessory.prototype.setVolume = function(direction, callback) {
  this.YAMAHA.getBasicInfo().done(
    (basicInfo) => {
      const volume = basicInfo.getVolume();

      if (direction === 0) {
        this.log('Volume Up', (volume + 5) / 10);
        this.YAMAHA.volumeUp(5);
      } else {
        this.log('Volume Down', (volume - 5) / 10);
        this.YAMAHA.volumeDown(5);
      }

      callback();
    }
  );
};

YamahaAVRAccessory.prototype.getInputState = function(callback) {
  this.YAMAHA.getBasicInfo().done(
    (basicInfo) => {
      const input = this.inputs.filter((input, index) => {
        if (input.id == basicInfo.getCurrentInput()) {
          this.log('Current Input: ' + input.name, index);
          callback(null, index);
        }
      });
    }
  );
};

YamahaAVRAccessory.prototype.setInputState = function(input, callback) {
  this.log('Set input:', input.name, '(' + input.id + ')');
  this.YAMAHA.setInputTo(input.id)
  callback();
};

YamahaAVRAccessory.prototype.sendRemoteCommand = function(control, remoteKey, callback) {
  this.log('Remote', remoteKey);

  const command = `<YAMAHA_AV cmd="PUT"><Main_Zone><Cursor_Control><${control}>${remoteKey}</${control}></Cursor_Control></Main_Zone></YAMAHA_AV>`;
  
  this.YAMAHA.SendXMLToReceiver(command).then(
    (RESULT) => {
      callback();
    }
  );
}

YamahaAVRAccessory.prototype.remoteKeyPress = function(remoteKey, callback) {
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
      callback();
      break;
    case Characteristic.RemoteKey.PREVIOUS_TRACK:
      callback();
      break;
    case Characteristic.RemoteKey.ARROW_UP:
      this.sendRemoteCommand('Cursor', 'Up', callback);
      break;
    case Characteristic.RemoteKey.ARROW_DOWN:
      this.sendRemoteCommand('Cursor', 'Down', callback);
      break;
    case Characteristic.RemoteKey.ARROW_LEFT:
      this.sendRemoteCommand('Cursor', 'Left', callback);
      break;
    case Characteristic.RemoteKey.ARROW_RIGHT:
      this.sendRemoteCommand('Cursor', 'Right', callback);
      break;
    case Characteristic.RemoteKey.SELECT:
      this.sendRemoteCommand('Cursor', 'Sel', callback);
      break;
    case Characteristic.RemoteKey.BACK:
      this.sendRemoteCommand('Cursor', 'Return', callback);
      break;
    case Characteristic.RemoteKey.EXIT:
      this.sendRemoteCommand('Cursor', 'Return', callback);
      break;
    case Characteristic.RemoteKey.PLAY_PAUSE:
      if (this.playing) {
        this.YAMAHA.pause();
      } else {
        this.YAMAHA.play();
      }

      this.playing = !this.playing;
      callback();

      break;
    case Characteristic.RemoteKey.INFORMATION:
      this.sendRemoteCommand('Menu_Control', 'Display', callback);
      break;
  }
};