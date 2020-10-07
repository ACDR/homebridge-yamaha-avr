import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import fetch from 'node-fetch';
import { YamahaAVRPlatform } from './platform';
import { PLUGIN_NAME } from './settings';

interface Input {
  id: string;
  name: string;
  index: number;
}

export class YamahaAVRAccessory {
  private service: Service;
  private inputServices: Service[] = [];

  private state = {
    isPlaying: true as boolean,
    inputs: [] as Input[],
    connectionError: false as boolean,
  };

  constructor(
    private readonly platform: YamahaAVRPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set the AVR accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Yamaha')
      .setCharacteristic(this.platform.Characteristic.Model, this.accessory.context.modelName || 'Unknown')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.systemId || 'Unknown')
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.accessory.context.firmwareVersion || 'Unknown');

    this.service = this.accessory.addService(this.platform.Service.Television);

    this.init();

    // regularly ping the AVR to keep power/input state syncronised
    setInterval(
      this.getPowerState.bind(this, this.updateAVRState.bind(this)),
      5000,
    );
  }

  async init() {
    await this.createTVService();
    await this.createTVSpeakerService();
    await this.createInputSourceServices();

    // Wait for all services to be created before publishing
    this.platform.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
  }

  async createTVService() {
    // Set Television Service Name & Discovery Mode
    this.service
      .setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        this.accessory.context.device.displayName,
      )
      .setCharacteristic(
        this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

    // Power State Get/Set
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.getPowerState.bind(this))
      .on('set', this.setPowerState.bind(this));

    // Input Source Get/Set
    this.service
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .on('get', this.getInputState.bind(this))
      .on('set', this.setInputState.bind(this));

    // Remote Key Set
    this.service.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .on('set', (newValue, callback) => {
        const sendRemoteCode = (remoteKey, callback) => {
          fetch(`http://${this.platform.config.ip}/YamahaExtendedControl/v1/system/sendIrCode?code=${remoteKey}`).then(response => {
            callback(response);
          });
        };

        switch(newValue) {
          case this.platform.Characteristic.RemoteKey.REWIND:
            this.platform.log.info('set Remote Key Pressed: REWIND');
            this.platform.YamahaAVR.rewind();
            callback(null);
            break;

          case this.platform.Characteristic.RemoteKey.FAST_FORWARD:
            this.platform.log.info('set Remote Key Pressed: FAST_FORWARD');
            this.platform.YamahaAVR.skip();
            callback(null);
            break;

          case this.platform.Characteristic.RemoteKey.NEXT_TRACK:
            this.platform.log.info('set Remote Key Pressed: NEXT_TRACK');
            sendRemoteCode('7F016D92', callback);
            break;

          case this.platform.Characteristic.RemoteKey.PREVIOUS_TRACK:
            this.platform.log.info('set Remote Key Pressed: PREVIOUS_TRACK');
            sendRemoteCode('7F016C93', callback);
            break;

          case this.platform.Characteristic.RemoteKey.ARROW_UP:
            this.platform.log.info('set Remote Key Pressed: ARROW_UP');
            sendRemoteCode('7A859D62', callback);
            break;

          case this.platform.Characteristic.RemoteKey.ARROW_DOWN:
            this.platform.log.info('set Remote Key Pressed: ARROW_DOWN');
            sendRemoteCode('7A859C63', callback);
            break;

          case this.platform.Characteristic.RemoteKey.ARROW_LEFT:
            this.platform.log.info('set Remote Key Pressed: ARROW_LEFT');
            sendRemoteCode('7A859F60', callback);
            break;

          case this.platform.Characteristic.RemoteKey.ARROW_RIGHT:
            this.platform.log.info('set Remote Key Pressed: ARROW_RIGHT');
            sendRemoteCode('7A859E61', callback);
            break;

          case this.platform.Characteristic.RemoteKey.SELECT:
            this.platform.log.info('set Remote Key Pressed: SELECT');
            sendRemoteCode('7A85DE21', callback);
            break;

          case this.platform.Characteristic.RemoteKey.BACK:
            this.platform.log.info('set Remote Key Pressed: BACK');
            sendRemoteCode('7A85AA55', callback);
            break;

          case this.platform.Characteristic.RemoteKey.EXIT:
            this.platform.log.info('set Remote Key Pressed: EXIT');
            sendRemoteCode('7A85AA55', callback);
            break;

          case this.platform.Characteristic.RemoteKey.PLAY_PAUSE:
            this.platform.log.info('set Remote Key Pressed: PLAY_PAUSE');
            if (this.state.isPlaying) {
              this.platform.YamahaAVR.pause();
              // this.sendRemoteCode('7F016798', callback);
            } else {
              this.platform.YamahaAVR.play();
              // this.sendRemoteCode('7F016897', callback);
            }

            this.state.isPlaying = !this.state.isPlaying;

            callback(null);

            break;

          case this.platform.Characteristic.RemoteKey.INFORMATION:
            this.platform.log.info('set Remote Key Pressed: INFORMATION');
            sendRemoteCode('7A851F60', callback);
            break;

          default:
            this.platform.log.info('unhandled Remote Key Pressed');
            break;
        }
      });

    return;
  }

  async createTVSpeakerService() {
    const speakerService = this.accessory.addService(this.platform.Service.TelevisionSpeaker);

    speakerService
      .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.platform.Characteristic.VolumeControlType, this.platform.Characteristic.VolumeControlType.ABSOLUTE);

    // handle volume control
    speakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .on('set', (direction: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.setVolume(direction, callback);
      });

    return;
  }

  async createInputSourceServices() {
    await this.updateInputSources();

    this.state.inputs.forEach((input, i) => {
      const inputService = this.accessory.addService(
        this.platform.Service.InputSource,
        this.platform.api.hap.uuid.generate(input.id),
        input.name,
      );

      inputService
        .setCharacteristic(this.platform.Characteristic.Identifier, i)
        .setCharacteristic(this.platform.Characteristic.Name, input.name)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.CurrentVisibilityState, this.platform.Characteristic.CurrentVisibilityState.SHOWN)
        .setCharacteristic(this.platform.Characteristic.InputSourceType, this.platform.Characteristic.InputSourceType.APPLICATION)
        .setCharacteristic(this.platform.Characteristic.InputDeviceType, this.platform.Characteristic.InputDeviceType.TV);


      inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName)
        .on('set', (name, callback) => {
          this.platform.log.debug(`Set input (${input.id}) name to ${name}`);
          inputService.updateCharacteristic(this.platform.Characteristic.ConfiguredName, name);
          callback(null);
        })
        .updateValue(input.name);

      inputService.getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
        .on('set', (visibility, callback) => {
          this.platform.log.debug(`setTargetVisibilityState => ${visibility}`);
          inputService.updateCharacteristic(this.platform.Characteristic.CurrentVisibilityState, visibility);
          callback(null);
        });

      inputService.getCharacteristic(this.platform.Characteristic.Name)
        .on('get', callback => callback(null, input.name));

      this.service.addLinkedService(inputService);
      this.inputServices.push(inputService);
    });
  }

  async updateInputSources() {
    const featuresXML = this.accessory.context.features;
    const features: string[] = [];

    for (const prop in featuresXML) {
      if (
        !prop.includes('Zone') &&
        featuresXML[prop].includes('1') &&
        !prop.includes('USB') &&
        !prop.includes('Tuner')
      ) {
        features.push(prop);
      }
    }

    return this.platform.YamahaAVR.getAvailableInputsWithNames()
      .then(availableInputs => {
        this.state.inputs = [];

        features.forEach((feature, i) => {
          this.state.inputs.push({
            id: feature.replace('_', ' '),
            name: feature.replace('_', ' '),
            index: i,
          });
        });

        // use index from the array that is filled by features
        let i = this.state.inputs.length;

        for (const key in availableInputs[0]) {
          // check if the property/key is defined in the object itself, not in parent
          if (availableInputs[0].hasOwnProperty(key)) { // eslint-disable-line
            let id = String(key).replace('_', '');

            if (key.includes('MusicCast_Link') || key.includes('NET_RADIO')) {
              id = String(key).replace('_', ' ');
            }

            const input: Input = {
              id,
              name: availableInputs[0][key][0],
              index: i,
            };

            if (!this.state.inputs.find(input => input.id === id)) {
              // add input only if it is not already in inputs
              this.state.inputs.push(input);
            }

            i++;
          }
        }

        if (this.inputServices.length === 0) {
          return;
        }

        this.state.inputs.forEach((input, i) => {
          // const inputService = this.inputServices[i];

          if (input.name) {
            // console.log(inputService.displayName, inputService.subtype, inputService.name);
          }

          // inputService.updateCharacteristic(
          //   this.platform.Characteristic.ConfiguredName,
          //   input.name,
          // );
        });

        return;
      })
      .catch(() => {
        this.platform.log.error(`
          Failed to get available inputs from ${this.platform.config.name}.
          Please verify the AVR is connected and accessible at ${this.platform.config.ip}
        `);

        return;
      });
  }

  updateAVRState(error, status) {
    this.service.updateCharacteristic(this.platform.Characteristic.Active, status);

    this.platform.YamahaAVR.getBasicInfo()
      .then(async (basicInfo) => {
        await this.updateInputSources();

        this.service.updateCharacteristic(
          this.platform.Characteristic.ActiveIdentifier,
          this.state.inputs.findIndex(input => input.id === basicInfo.getCurrentInput()),
        );

        if (this.state.connectionError) {
          this.state.connectionError = false;
          this.platform.log.info(`Communication with Yamaha AVR at ${this.platform.config.ip} restored`);
        }

        return;
      })
      .catch(() => {
        if (this.state.connectionError) {
          return;
        }

        this.state.connectionError = true;
        this.platform.log.error(`
          Cannot communicate with Yamaha AVR at ${this.platform.config.ip}.
          Connection will be restored automatically when the AVR begins responding.
        `);
      });
  }

  getPowerState(callback: CharacteristicGetCallback) {
    this.platform.YamahaAVR.isOn()
      .then(result => {
        callback(null, result);
      })
      .catch(error => {
        callback(error, false);
      });
  }

  setPowerState(state: CharacteristicValue, callback: CharacteristicSetCallback) {
    if (state) {
      this.platform.log.info('Power On');
      this.platform.YamahaAVR.powerOn();
    } else {
      this.platform.log.info('Power Off');
      this.platform.YamahaAVR.powerOff();
    }

    callback(null);
  }

  setVolume(direction: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.platform.YamahaAVR.getBasicInfo()
      .then(basicInfo => {
        const volume = basicInfo.getVolume();

        if (direction === 0) {
          this.platform.log.info('Volume Up', (volume + 5) / 10);
          this.platform.YamahaAVR.volumeUp(5);
        } else {
          this.platform.log.info('Volume Down', (volume - 5) / 10);
          this.platform.YamahaAVR.volumeDown(5);
        }

        callback(null);
      })
      .catch(error => {
        callback(error, false);
      });
  }

  getInputState(callback: CharacteristicGetCallback) {
    this.platform.YamahaAVR.getBasicInfo()
      .then(basicInfo => {
        const input: Input | undefined = this.state.inputs.find(input => input.id === basicInfo.getCurrentInput());

        this.platform.log.debug(`Current input: ${basicInfo.getCurrentInput()}`);

        if (!input) {
          return;
        }

        this.platform.log.info(`Current input: ${input.name} (${input.id})`);

        this.state.inputs.filter((input, index) => {
          if (input.id === basicInfo.getCurrentInput()) {
            return callback(null, index);
          }

          return;
        });
      });
  }

  setInputState(inputIdentifier: CharacteristicValue, callback: CharacteristicSetCallback) {
    const input: Input = this.state.inputs[Number(inputIdentifier)];
    this.platform.log.info(`Set input: ${input.name} (${input.id})`);
    this.platform.YamahaAVR.setInputTo(input.id);
    callback(null);
  }
}
