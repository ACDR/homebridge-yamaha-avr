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
  this.availableSceneServices = [];
  this.playing = true;
  this.scenes = config.scenes;

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
         var sanitizedInputs = [];
         // If no inputs defined in config - set available inputs as returned from receiver
         this.YAMAHA.getAvailableInputsWithNames().then((availableInputs) => {
            //this.log("Got input:", availableInputs);
            var i = 0;
            for (var key in availableInputs[0]) {
               // check if the property/key is defined in the object itself, not in parent
               if (availableInputs[0].hasOwnProperty(key)) {   
                  var id = String(key).replace("_", "");       
                  var input = {
                     id: id,
                     name: availableInputs[0][key][0],
                     index: i  
                  }
                  sanitizedInputs.push(input);
                  i++;
               }
            }
            //this.log(sanitizedInputs);
            // Create the Yamaha AVR Accessory
            if (this.config.inputs) {
               this.log("inputs true");
            var filteredInputs = []
            this.config.inputs.forEach((input, i) =>
            {
               sanitizedInputs.forEach((sanitizedInput) =>
               {
                  if (sanitizedInput.id === input.id)
                  {
                     input.index = i;
                     filteredInputs.push(input);
                  }
               });
            });
            callback([
               new YamahaAVRAccessory(
                  this.log,
                  this.config,
                  this.YAMAHA,
                  sysConfig,
                  filteredInputs,
               ),
            ]);
            } else {
               this.log("inputs false", sanitizedInputs);
               callback([
                  new YamahaAVRAccessory(
                  this.log,
                  this.config,
                  this.YAMAHA,
                  sysConfig,
                  sanitizedInputs,
                  ),
               ]);
            
            }
         });
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
    this.volumeService();
    this.televisionService();
    this.televisionSpeakerService();
    this.inputSourceServices();
    this.sceneServices();

    return this.enabledServices;
  },

  volumeService() {
   this.volumeService = new Service.Lightbulb(this.name + ' Volume', 'volumeService');
   this.volumeService
       .getCharacteristic(Characteristic.On)
       .on('get', this.getMuteState.bind(this))
       .on('set', this.setMuteState.bind(this));
   this.volumeService
       .addCharacteristic(new Characteristic.Brightness())
       .on('get', this.getVolume.bind(this))
       .on('set', this.setVolume.bind(this));

   this.enabledServices.push(this.volumeService);
  },

  sceneServices() {
   this.scenes.forEach((scene, i) =>
   {
      this.log("scene: ",scene);
      const sceneService = new Service.Switch(scene.name, `sceneService ${scene.index}`);
      sceneService
         .setCharacteristic(Characteristic.Name, scene.name)
      sceneService
         .getCharacteristic(Characteristic.On)
         //.on('get', this.getSceneState.bind(this))
         .on('set', (value, callback) => {
            this.setSceneState(i, value, callback);
         });

         this.tvService.addLinkedService(sceneService);
      this.enabledServices.push(sceneService);
      this.availableSceneServices.push(sceneService);
   });
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

    this.tvSpeakerService
        .addCharacteristic(Characteristic.Volume)
        .on('get', this.getVolume.bind(this))
        .on('set', this.setVolume.bind(this));

        this.tvSpeakerService
        .getCharacteristic(Characteristic.Mute)
        .on('get', this.getMuteState.bind(this))
        .on('set', this.setMuteState.bind(this));
    this.tvService.addLinkedService(this.tvSpeakerService);
    this.enabledServices.push(this.tvSpeakerService);
  },

  inputSourceServices() {
    this.inputs.forEach((input, i) => {
       this.log("adding input source ", input.index, input.name, input.id);
      const inputService = new Service.InputSource(input.id, `inputSource${input.index}`);

      inputService
        .setCharacteristic(Characteristic.Identifier, input.index)
        .setCharacteristic(Characteristic.ConfiguredName, input.name)
        .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION)
        .setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN);

      inputService
        .getCharacteristic(Characteristic.ConfiguredName)
        .on('set', (value, callback) => {
          callback(null, value);
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
                this.log(`Updating input from ${input.name} to ${input.name}`);
                return this.tvService.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(index);
              }
            }
            return null;
          });
        });
      }
      return null;
    }
    return null;
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

  //The AVR reports volume *10, e.g. 28.5 becomes 285

  setVolume(value, callback) {
   if (value === 0) {
      this.YAMAHA.muteOn();
   }
   else {
      var volume = Math.round((value/2.5-50)*10);
      volume = volume - (volume %5);
      this.log("setting volume to ", volume);
      this.YAMAHA.setVolumeTo(volume);
   }
   callback();
  },

  getVolume(callback) {
   this.YAMAHA.getBasicInfo().done((basicInfo) => {
     var volume = Math.round((basicInfo.getVolume()/10+50)*2.5);
     volume = volume - (volume % 5);
     this.log("The current volume is", volume);

     callback(null, volume);
   });
 },

  setMuteState(val, callback) {
   callback();
  },

  getMuteState(callback) {
   this.YAMAHA.getBasicInfo().done((basicInfo) => {
      
   const muted = basicInfo.isMuted();
   callback(null, !muted);
   });
  },

  getSceneState(callback) {
     //scenes are always "off"
     callback(null, false);
  },

  getInputState(callback) {
     //this.log("getInputState");
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

  setSceneState(index, value, callback) {
     if (value == true) {
      this.scenes.forEach((scene) => {
      if (scene.index == index+1)
      {
         this.availableSceneServices.forEach((service) => {
            if (service.getCharacteristic(Characteristic.Name).value != scene.name) {
               service.getCharacteristic(Characteristic.On).updateValue(false);
            }
         });
         this.log(`seting scene ${scene.name} to ${value}`);

      }
      });
      this.YAMAHA.setSceneTo(index+1);
     }
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
