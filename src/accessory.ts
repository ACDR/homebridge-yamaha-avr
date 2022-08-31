import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';
import fetch from 'node-fetch';
import { YamahaAVRPlatform } from './platform';
import { PLUGIN_NAME } from './settings';
import { StorageService } from './storageService';

interface Input {
  id: string;
  name: string;
}

interface CachedServiceData {
  Identifier: number;
  CurrentVisibilityState: number;
  ConfiguredName: string;
}

export interface AccessoryContext {
  systemId?: string;
  modelName?: string;
  firmwareVersion?: string;
  device: {
    UUID: string;
    displayName: string;
  };
  features: string[];
}

export class YamahaAVRAccessory {
  private service: Service;
  private inputServices: Service[] = [];
  private storageService: StorageService;

  private state = {
    isPlaying: true as boolean,
    inputs: [] as Input[],
    connectionError: false as boolean,
  };

  constructor(
    private readonly platform: YamahaAVRPlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
  ) {
    const cacheDirectory = this.platform.config.cacheDirectory || this.platform.api.user.storagePath() + '/.yamahaAVR/';
    this.storageService = new StorageService(cacheDirectory);
    this.storageService.initSync();

    // set the AVR accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Yamaha')
      .setCharacteristic(this.platform.Characteristic.Model, this.accessory.context.modelName || 'Unknown')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.systemId || 'Unknown')
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        this.accessory.context.firmwareVersion || 'Unknown',
      );

    this.service = this.accessory.addService(this.platform.Service.Television);

    this.init();

    // regularly ping the AVR to keep power/input state syncronised
    setInterval(this.getPowerState.bind(this, this.updateAVRState.bind(this)), 5000);
  }

  async init() {
    try {
      await this.createTVService();
      await this.createTVSpeakerService();
      await this.createInputSourceServices();

      // Wait for all services to be created before publishing
      this.platform.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
    } catch (err) {
      this.platform.log.error(err as string);
    }
  }

  async createTVService() {
    // Set Television Service Name & Discovery Mode
    this.service
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.accessory.context.device.displayName)
      .setCharacteristic(
        this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

    // Power State Get/Set
    this.service
      .getCharacteristic(this.platform.Characteristic.Active)
      .on('get', this.getPowerState.bind(this))
      .on('set', this.setPowerState.bind(this));

    // Input Source Get/Set
    this.service
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .on('get', this.getInputState.bind(this))
      .on('set', this.setInputState.bind(this));

    // Remote Key Set
    this.service.getCharacteristic(this.platform.Characteristic.RemoteKey).on('set', (newValue, callback) => {
      const sendRemoteCode = (remoteKey, callback) => {
        fetch(`http://${this.platform.config.ip}/YamahaExtendedControl/v1/system/sendIrCode?code=${remoteKey}`).then(
          (response) => {
            callback(response);
          },
        );
      };

      switch (newValue) {
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
      .setCharacteristic(
        this.platform.Characteristic.VolumeControlType,
        this.platform.Characteristic.VolumeControlType.ABSOLUTE,
      );

    // handle volume control
    speakerService
      .getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .on('set', (direction: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.setVolume(direction, callback);
      });

    return;
  }

  async createInputSourceServices() {
    await this.updateInputSources();

    return new Promise<void>((resolve, reject) => {
      this.state.inputs.forEach(async (input, i) => {
        const cachedService = await this.storageService.getItem<CachedServiceData>(input.id);

        try {
          const inputService = this.accessory.addService(
            this.platform.Service.InputSource,
            this.platform.api.hap.uuid.generate(input.id),
            input.name,
          );

          inputService
            .setCharacteristic(this.platform.Characteristic.Identifier, i)
            .setCharacteristic(this.platform.Characteristic.Name, input.name)
            .setCharacteristic(this.platform.Characteristic.ConfiguredName, cachedService?.ConfiguredName || input.name)
            .setCharacteristic(
              this.platform.Characteristic.IsConfigured,
              this.platform.Characteristic.IsConfigured.CONFIGURED,
            )
            .setCharacteristic(
              this.platform.Characteristic.CurrentVisibilityState,
              this.platform.Characteristic.CurrentVisibilityState.SHOWN,
            )
            .setCharacteristic(
              this.platform.Characteristic.InputSourceType,
              this.platform.Characteristic.InputSourceType.APPLICATION,
            )
            .setCharacteristic(
              this.platform.Characteristic.InputDeviceType,
              this.platform.Characteristic.InputDeviceType.TV,
            );

          // Update input name cache
          inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName).on('set', (name, callback) => {
            this.platform.log.debug(`Set input (${input.id}) name to ${name}`);

            let configuredName = name;

            if (!name || input.name === name) {
              this.platform.log.debug(`Custom name not provided, clearing configured input name for`, input.name);

              configuredName = input.name;
            }

            inputService.updateCharacteristic(this.platform.Characteristic.ConfiguredName, configuredName);

            this.storageService.setItemSync(input.id, {
              ConfiguredName: configuredName,
              CurrentVisibilityState: inputService.getCharacteristic(
                this.platform.Characteristic.CurrentVisibilityState,
              ).value,
            });

            callback(null);
          });

          // Update input visibility cache
          inputService
            .getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
            .on('set', (targetVisibilityState, callback) => {
              const isHidden = targetVisibilityState === this.platform.Characteristic.TargetVisibilityState.HIDDEN;

              this.platform.log.debug(`Set input (${input.id}) visibility state to ${isHidden ? 'HIDDEN' : 'SHOWN'} `);

              inputService.updateCharacteristic(
                this.platform.Characteristic.CurrentVisibilityState,
                targetVisibilityState,
              );

              this.storageService.setItemSync(input.id, {
                ConfiguredName:
                  inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName).value || input.name,
                CurrentVisibilityState: targetVisibilityState,
              });

              callback(null);
            });

          inputService
            .getCharacteristic(this.platform.Characteristic.Name)
            .on('get', (callback) => callback(null, input.name));

          if (cachedService) {
            if (this.platform.Characteristic.CurrentVisibilityState.SHOWN !== cachedService.CurrentVisibilityState) {
              this.platform.log.debug(`Restoring input ${input.id} visibility state from cache`);
              inputService.setCharacteristic(
                this.platform.Characteristic.CurrentVisibilityState,
                cachedService.CurrentVisibilityState,
              );
            }

            if (input.name !== cachedService.ConfiguredName && cachedService.ConfiguredName !== '') {
              this.platform.log.debug(`Restoring input ${input.id} configured name from cache`);
              inputService.setCharacteristic(this.platform.Characteristic.ConfiguredName, cachedService.ConfiguredName);
            }
          }

          this.service.addLinkedService(inputService);
          this.inputServices.push(inputService);

          try {
            // Cache Data
            const name =
              inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName).value || input.name;
            const visibility = inputService.getCharacteristic(
              this.platform.Characteristic.CurrentVisibilityState,
            ).value;

            if (cachedService?.ConfiguredName === name && cachedService.CurrentVisibilityState === visibility) {
              resolve();
              return;
            }

            this.platform.log.debug(
              `Cache input (${input.id}). Name: "${name}", Visibility: "${visibility ? 'HIDDEN' : 'SHOWN'}" `,
            );

            this.storageService.setItemSync(input.id, {
              ConfiguredName: name,
              CurrentVisibilityState: visibility,
            });

            if (this.inputServices.length === this.state.inputs.length) {
              resolve();
            }
          } catch (err) {
            reject(`
              Could not write to cache.
              Please check your Homebridge instance has permission to write to
              "${this.platform.config.cacheDirectory}"
              or set a different cache directory using the "cacheDirectory" config property.
            `);
          }
        } catch (err) {
          this.platform.log.error(`
            Failed to add input service ${input.name}:
            ${err}
          `);
        }
      });
    });
  }

  async updateInputSources() {
    const features = this.accessory.context.features;

    return this.platform.YamahaAVR.getAvailableInputsWithNames()
      .then((availableInputs) => {
        this.platform.log.debug('features', features);
        this.platform.log.debug('availableInputs', availableInputs);

        const inputs = [
          ...features,
          ...Object.keys(availableInputs[0]).filter(
            (input) => !features.map((feature) => feature.toUpperCase()).includes(input.toUpperCase()),
          ),
        ].map((input) => ({
          id: input.replace('_', ''),
          name: (availableInputs[0][input] ? availableInputs[0][input][0] : input).replace('_', ' '),
        }));

        this.platform.log.debug('inputs', inputs);

        this.state.inputs = inputs;

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

        const currentInputIndex = this.state.inputs.findIndex(
          (input) => input.id === basicInfo.getCurrentInput().replace(/[^a-z0-9]/gi, ''),
        );

        if (currentInputIndex > -1) {
          this.service.updateCharacteristic(this.platform.Characteristic.ActiveIdentifier, currentInputIndex);
        } else {
          this.platform.log.error(`Unexpected input: "${basicInfo.getCurrentInput()}"`, this.state.inputs);
        }

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
      .then((result) => {
        callback(null, result);
      })
      .catch((error) => {
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
      .then((basicInfo) => {
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
      .catch((error) => {
        callback(error, false);
      });
  }

  getInputState(callback: CharacteristicGetCallback) {
    this.platform.YamahaAVR.getBasicInfo().then((basicInfo) => {
      const input: Input | undefined = this.state.inputs.find((input) => input.id === basicInfo.getCurrentInput());

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
