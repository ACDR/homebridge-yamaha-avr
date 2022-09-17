import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import fetch from 'node-fetch';

import { YamahaAVRPlatform } from './platform.js';
import { StorageService } from './storageService.js';
import { AccessoryContext, BaseResponse, Cursor, Input, MainZoneRemoteCode, Zone } from './types.js';

interface CachedServiceData {
  Identifier: number;
  CurrentVisibilityState: number;
  ConfiguredName: string;
}

export class YamahaAVRAccessory {
  private baseApiUrl: AccessoryContext['device']['baseApiUrl'];
  private cacheDirectory: string;
  private service: Service;
  private inputServices: Service[] = [];
  private storageService: StorageService;

  private state: {
    isPlaying: boolean;
    inputs: Input[];
    connectionError: boolean;
  } = {
    isPlaying: true,
    inputs: [],
    connectionError: false,
  };

  constructor(
    private readonly platform: YamahaAVRPlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
    private readonly zone: Zone['id'],
  ) {
    this.cacheDirectory = this.platform.config.cacheDirectory
      ? `${this.platform.config.cacheDirectory}/${this.zone}`.replace('//', '/')
      : this.platform.api.user.storagePath() + '/.yamahaAVR/' + this.zone;
    this.storageService = new StorageService(this.cacheDirectory);
    this.storageService.initSync();

    this.platform.log.debug('cache directory', this.cacheDirectory);

    // set the AVR accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Yamaha')
      .setCharacteristic(this.platform.Characteristic.Model, this.accessory.context.device.modelName)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.systemId)
      .setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        `${this.accessory.context.device.firmwareVersion}`,
      );

    this.service = this.accessory.addService(this.platform.Service.Television);

    this.baseApiUrl = this.accessory.context.device.baseApiUrl;
    this.init();

    // regularly ping the AVR to keep power/input state syncronised
    setInterval(this.updateAVRState.bind(this), 5000);
  }

  formatAvrInputId(id) {
    switch (id) {
      case 'Tuner':
        return 'TUNER';

      case 'NET_RADIO':
        return 'NET RADIO';

      case 'Amazon_Music':
        return 'Amazon Music';

      case 'MusicCast_Link':
        return 'MusicCast Link';

      case 'V_AUX':
        return 'V-AUX';

      default:
        return id.replace('_', '');
    }
  }

  formatInputId(inputId: string) {
    return inputId.replace(/[^a-z0-9]/gi, '').toUpperCase();
  }

  getActiveInputIndex(inputId: string) {
    return this.state.inputs.map((input) => input.id).indexOf(this.formatInputId(inputId));
  }

  async init() {
    try {
      await this.updateInputSources();
      await this.createTVService();
      await this.createTVSpeakerService();
      await this.createInputSourceServices();
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
      .onSet(this.setPowerState.bind(this))
      .onGet(this.getPowerState.bind(this));

    // Input Source Get/Set
    this.service
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onSet(this.setInputState.bind(this))
      .onGet(this.getInputState.bind(this));

    // Remote Key Set
    this.service.getCharacteristic(this.platform.Characteristic.RemoteKey).onSet(this.setRemoteKey.bind(this));

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
    speakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector).onSet(this.setVolume.bind(this));

    return;
  }

  async createInputSourceServices() {
    this.state.inputs.forEach(async (input, i) => {
      const cachedService = await this.storageService.getItem<CachedServiceData>(input.id);

      try {
        const inputService = this.accessory.addService(this.platform.Service.InputSource, input.name, input.id);

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
        inputService
          .getCharacteristic(this.platform.Characteristic.ConfiguredName)
          .onGet(async (): Promise<CharacteristicValue> => {
            const cachedServiceGet = await this.storageService.getItem<CachedServiceData>(input.id);
            return cachedServiceGet?.ConfiguredName || input.name;
          })
          .onSet((name: CharacteristicValue) => {
            const currentConfiguredName = inputService.getCharacteristic(
              this.platform.Characteristic.ConfiguredName,
            ).value;

            if (name === currentConfiguredName) {
              return;
            }

            this.platform.log.debug(`Set input (${input.id}) name to ${name} `);

            const configuredName = name || input.name;

            inputService.updateCharacteristic(this.platform.Characteristic.ConfiguredName, configuredName);

            this.storageService.setItemSync(input.id, {
              ConfiguredName: configuredName,
              CurrentVisibilityState: inputService.getCharacteristic(
                this.platform.Characteristic.CurrentVisibilityState,
              ).value,
            });
          });

        // Update input visibility cache
        inputService
          .getCharacteristic(this.platform.Characteristic.TargetVisibilityState)
          .onGet(async (): Promise<CharacteristicValue> => {
            const cachedServiceGet = await this.storageService.getItem<CachedServiceData>(input.id);
            return cachedServiceGet?.CurrentVisibilityState || 0;
          })
          .onSet((targetVisibilityState: CharacteristicValue) => {
            const currentVisbility = inputService.getCharacteristic(
              this.platform.Characteristic.CurrentVisibilityState,
            ).value;

            if (targetVisibilityState === currentVisbility) {
              return;
            }

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
          });

        inputService.getCharacteristic(this.platform.Characteristic.Name).onGet((): CharacteristicValue => input.name);

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
          const name = inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName).value || input.name;
          const visibility = inputService.getCharacteristic(this.platform.Characteristic.CurrentVisibilityState).value;

          if (cachedService?.ConfiguredName === name && cachedService.CurrentVisibilityState === visibility) {
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
            return;
          }
        } catch (err) {
          this.platform.log.error(
            `
            Could not write to cache.
            Please check your Homebridge instance has permission to write to
            "${this.cacheDirectory}"
            or set a different cache directory using the "cacheDirectory" config property.
          `,
          );
        }
      } catch (err) {
        this.platform.log.error(`
          Failed to add input service ${input.id}:
          ${err}
        `);
      }
    });
  }

  async updateInputSources() {
    try {
      const availableInputs = await this.platform.YamahaAVR.getAvailableInputsWithNames();

      const inputs = [
        ...Object.entries(availableInputs[0]).map(([id, name]) => ({
          avrId: this.formatAvrInputId(id),
          id: this.formatInputId(id),
          name: name[0],
        })),
      ];

      const features = this.platform.features
        .map((id) => ({
          avrId: this.formatAvrInputId(id),
          id: this.formatInputId(id),
          name: id.replace('_', ' '),
        }))
        .filter((feature) => !inputs.map((input) => input.id).includes(feature.id));

      this.state.inputs = [...inputs, ...features];

      this.platform.log.debug('inputs', this.state.inputs);
    } catch {
      this.platform.log.error(`
          Failed to get available inputs from ${this.platform.config.name}.
          Please verify the AVR is connected and accessible at ${this.platform.config.ip}
        `);
    }
  }

  async updateAVRState() {
    try {
      const basicInfo = await this.platform.YamahaAVR.getBasicInfo();

      this.service.updateCharacteristic(
        this.platform.Characteristic.Active,
        basicInfo.isOn() ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
      );

      this.service.updateCharacteristic(
        this.platform.Characteristic.ActiveIdentifier,
        this.getActiveInputIndex(basicInfo.getCurrentInput()),
      );

      if (this.state.connectionError) {
        this.state.connectionError = false;
        this.platform.log.info(`Communication with Yamaha AVR at ${this.platform.config.ip} restored`);
      }
    } catch {
      if (this.state.connectionError) {
        return;
      }

      this.state.connectionError = true;
      this.platform.log.error(`
        Cannot communicate with Yamaha AVR at ${this.platform.config.ip}.
        Connection will be restored automatically when the AVR begins responding.
      `);
    }
  }

  async getPowerState(): Promise<CharacteristicValue> {
    return this.platform.YamahaAVR.isOn();
  }

  async setPowerState(isOn: CharacteristicValue) {
    if (isOn) {
      await this.platform.YamahaAVR.powerOff();
      return;
    }

    this.platform.YamahaAVR.powerOn();
  }

  async setRemoteKey(remoteKey: CharacteristicValue) {
    try {
      const sendRemoteCode = async (remoteKey: MainZoneRemoteCode) => {
        // TODO: Work out a way to send IR Codes via XML API
        const sendIrCodeResponse = await fetch(`${this.baseApiUrl}/system/sendIrCode?code=${remoteKey}`);
        const responseJson = (await sendIrCodeResponse.json()) as BaseResponse;

        if (responseJson.response_code !== 0) {
          throw new Error('Failed to send ir code');
        }
      };

      const controlCursor = async (cursor: Cursor) => {
        this.platform.YamahaAVR.remoteCursor(cursor);
      };

      switch (remoteKey) {
        case this.platform.Characteristic.RemoteKey.REWIND:
          this.platform.log.info('set Remote Key Pressed: REWIND');
          this.platform.YamahaAVR.rewind();
          break;

        case this.platform.Characteristic.RemoteKey.FAST_FORWARD:
          this.platform.log.info('set Remote Key Pressed: FAST_FORWARD');
          this.platform.YamahaAVR.skip();
          break;

        case this.platform.Characteristic.RemoteKey.NEXT_TRACK:
          this.platform.log.info('set Remote Key Pressed: NEXT_TRACK');
          sendRemoteCode(MainZoneRemoteCode.SKIP_FWD);
          break;

        case this.platform.Characteristic.RemoteKey.PREVIOUS_TRACK:
          this.platform.log.info('set Remote Key Pressed: PREVIOUS_TRACK');
          sendRemoteCode(MainZoneRemoteCode.SKIP_BACK);
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_UP:
          this.platform.log.info('set Remote Key Pressed: ARROW_UP');
          controlCursor('Up');
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_DOWN:
          this.platform.log.info('set Remote Key Pressed: ARROW_DOWN');
          controlCursor('Down');
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_LEFT:
          this.platform.log.info('set Remote Key Pressed: ARROW_LEFT');
          controlCursor('Left');
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_RIGHT:
          this.platform.log.info('set Remote Key Pressed: ARROW_RIGHT');
          controlCursor('Right');
          break;

        case this.platform.Characteristic.RemoteKey.SELECT:
          this.platform.log.info('set Remote Key Pressed: SELECT');
          controlCursor('Sel');
          break;

        case this.platform.Characteristic.RemoteKey.BACK:
          this.platform.log.info('set Remote Key Pressed: BACK');
          controlCursor('Return');
          break;

        case this.platform.Characteristic.RemoteKey.EXIT:
          this.platform.log.info('set Remote Key Pressed: EXIT');
          sendRemoteCode(MainZoneRemoteCode.TOP_MENU);
          break;

        case this.platform.Characteristic.RemoteKey.PLAY_PAUSE:
          this.platform.log.info('set Remote Key Pressed: PLAY_PAUSE');
          if (this.state.isPlaying) {
            this.platform.YamahaAVR.pause();
          } else {
            this.platform.YamahaAVR.play();
          }

          this.state.isPlaying = !this.state.isPlaying;

          break;

        case this.platform.Characteristic.RemoteKey.INFORMATION:
          this.platform.log.info('set Remote Key Pressed: INFORMATION');
          // We'll use the info button to flick through inputs
          sendRemoteCode(MainZoneRemoteCode.INPUT_FWD);
          break;

        default:
          this.platform.log.info('unhandled Remote Key Pressed');
          break;
      }
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }

  async setVolume(direction: CharacteristicValue) {
    try {
      const basicInfo = await this.platform.YamahaAVR.getBasicInfo();
      const volume = basicInfo.getVolume();

      if (direction === 0) {
        this.platform.log.info('Volume Up', (volume + 5) / 10);
        this.platform.YamahaAVR.volumeUp(5);
      } else {
        this.platform.log.info('Volume Down', (volume - 5) / 10);
        this.platform.YamahaAVR.volumeDown(5);
      }
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }

  async getInputState(): Promise<CharacteristicValue> {
    try {
      const basicInfo = await this.platform.YamahaAVR.getBasicInfo();

      this.platform.log.debug(`Current input: ${basicInfo.getCurrentInput()}`);

      return this.getActiveInputIndex(basicInfo.getCurrentInput());
    } catch (error) {
      this.platform.log.error((error as Error).message);
      return 0;
    }
  }

  async setInputState(inputIndex: CharacteristicValue) {
    try {
      const input: Input = this.state.inputs[inputIndex as number];
      this.platform.YamahaAVR.setInputTo(input.avrId);
      this.platform.log.info(`Set input: ${input.id}`);
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }
}
