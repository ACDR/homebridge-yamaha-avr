import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import fetch, { Response } from 'node-fetch';

import { YamahaAVRPlatform } from './platform.js';
import { StorageService } from './storageService.js';
import {
  AccessoryContext,
  BaseResponse,
  Cursor,
  Features,
  Input,
  MainZoneRemoteCode,
  NameText,
  Zone,
  ZoneStatus,
} from './types.js';

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
    isPlaying: boolean; // TODO: Investigaste a better way of tracking "playing" state
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
    this.cacheDirectory =
      this.platform.config.cacheDirectory || this.platform.api.user.storagePath() + '/.yamahaAVR/' + this.zone;
    this.storageService = new StorageService(this.cacheDirectory);
    this.storageService.initSync();

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

  async init() {
    try {
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
    await this.updateInputSources();

    return new Promise<void>((resolve, reject) => {
      this.state.inputs.forEach(async (input, i) => {
        const cachedService = await this.storageService.getItem<CachedServiceData>(input.id);

        try {
          const inputService = this.accessory.addService(
            this.platform.Service.InputSource,
            this.platform.api.hap.uuid.generate(input.id),
            input.text,
          );

          inputService
            .setCharacteristic(this.platform.Characteristic.Identifier, i)
            .setCharacteristic(this.platform.Characteristic.Name, input.text)
            .setCharacteristic(this.platform.Characteristic.ConfiguredName, cachedService?.ConfiguredName || input.text)
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
            .onGet((): CharacteristicValue => cachedService?.ConfiguredName || input.text)
            .onSet((name: CharacteristicValue) => {
              const currentConfiguredName = inputService.getCharacteristic(
                this.platform.Characteristic.ConfiguredName,
              ).value;

              if (name === currentConfiguredName) {
                return;
              }

              this.platform.log.debug(`Set input (${input.id}) name to ${name} `);

              const configuredName = name || input.text;

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
            .onGet((): CharacteristicValue => cachedService?.CurrentVisibilityState || 0)
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
                  inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName).value || input.text,
                CurrentVisibilityState: targetVisibilityState,
              });
            });

          inputService
            .getCharacteristic(this.platform.Characteristic.Name)
            .onGet((): CharacteristicValue => input.text);

          if (cachedService) {
            if (this.platform.Characteristic.CurrentVisibilityState.SHOWN !== cachedService.CurrentVisibilityState) {
              this.platform.log.debug(`Restoring input ${input.id} visibility state from cache`);

              inputService.setCharacteristic(
                this.platform.Characteristic.CurrentVisibilityState,
                cachedService.CurrentVisibilityState,
              );
            }

            if (input.text !== cachedService.ConfiguredName && cachedService.ConfiguredName !== '') {
              this.platform.log.debug(`Restoring input ${input.id} configured name from cache`);
              inputService.setCharacteristic(this.platform.Characteristic.ConfiguredName, cachedService.ConfiguredName);
            }
          }

          this.service.addLinkedService(inputService);
          this.inputServices.push(inputService);

          try {
            // Cache Data
            const name =
              inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName).value || input.text;
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
            reject(
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
    });
  }

  async updateInputSources() {
    try {
      const featuresResponse = await fetch(`${this.baseApiUrl}/system/getFeatures`);
      const features = (await featuresResponse.json()) as Features;
      const zoneInputs = features.zone.find((zone) => zone.id === this.zone)?.input_list;

      if (!zoneInputs) {
        throw new Error();
      }

      const getNameTextResponse = await fetch(`${this.baseApiUrl}/system/getNameText`);
      const nameText = (await getNameTextResponse.json()) as NameText;

      this.state.inputs = nameText.input_list.filter((input) => zoneInputs.includes(input.id));
    } catch {
      this.platform.log.error(`
      Failed to get available inputs from ${this.platform.config.name}.
      Please verify the AVR is connected and accessible at ${this.platform.config.ip}
    `);
    }
  }

  async getZoneStatus(): Promise<ZoneStatus | void> {
    try {
      const zoneStatusResponse = await fetch(`${this.baseApiUrl}/${this.zone}/getStatus`);
      const zoneStatus = (await zoneStatusResponse.json()) as ZoneStatus;

      if (zoneStatus.response_code !== 0) {
        throw new Error();
      }

      return zoneStatus;
    } catch {
      this.platform.log.error('Failed to fetch zone status');
    }
  }

  async updateAVRState() {
    try {
      const zoneStatus = await this.getZoneStatus();

      if (!zoneStatus) {
        throw new Error('Failed to fetch zone power status');
      }

      this.platform.log.debug(`AVR PING`, { power: zoneStatus.power, input: zoneStatus.input });

      this.service.updateCharacteristic(this.platform.Characteristic.Active, zoneStatus.power === 'on');

      this.service.updateCharacteristic(
        this.platform.Characteristic.ActiveIdentifier,
        this.state.inputs.findIndex((input) => input.id === zoneStatus.input),
      );

      if (this.state.connectionError) {
        this.state.connectionError = false;
        this.platform.log.info(`Communication with Yamaha AVR at ${this.platform.config.ip} restored`);
      }
    } catch (error) {
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
    const zoneStatus = await this.getZoneStatus();

    if (!zoneStatus) {
      return false;
    }

    return zoneStatus.power === 'on';
  }

  async setPowerState(state: CharacteristicValue) {
    try {
      let setPowerResponse: Response;

      if (state) {
        setPowerResponse = await fetch(`${this.baseApiUrl}/${this.zone}/setPower?power=on`);
      } else {
        setPowerResponse = await fetch(`${this.baseApiUrl}/${this.zone}/setPower?power=standby`);
      }

      const responseJson = (await setPowerResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error('Failed to set zone power');
      }
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }

  async setRemoteKey(remoteKey: CharacteristicValue) {
    try {
      const sendRemoteCode = async (remoteKey: MainZoneRemoteCode) => {
        const sendIrCodeResponse = await fetch(`${this.baseApiUrl}/system/sendIrCode?code=${remoteKey}`);
        const responseJson = (await sendIrCodeResponse.json()) as BaseResponse;

        if (responseJson.response_code !== 0) {
          throw new Error('Failed to send ir code');
        }
      };

      const controlCursor = async (cursor: Cursor) => {
        const controlCursorResponse = await fetch(`${this.baseApiUrl}/${this.zone}/controlCursor?cursor=${cursor}`);
        const responseJson = (await controlCursorResponse.json()) as BaseResponse;
        if (responseJson.response_code !== 0) {
          throw new Error('Failed to control cursor');
        }
      };

      switch (remoteKey) {
        case this.platform.Characteristic.RemoteKey.REWIND:
          this.platform.log.info('set Remote Key Pressed: REWIND');
          sendRemoteCode(MainZoneRemoteCode.SEARCH_BACK);
          break;

        case this.platform.Characteristic.RemoteKey.FAST_FORWARD:
          this.platform.log.info('set Remote Key Pressed: FAST_FORWARD');
          sendRemoteCode(MainZoneRemoteCode.SEARCH_FWD);
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
          controlCursor('up');
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_DOWN:
          this.platform.log.info('set Remote Key Pressed: ARROW_DOWN');
          controlCursor('down');
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_LEFT:
          this.platform.log.info('set Remote Key Pressed: ARROW_LEFT');
          controlCursor('left');
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_RIGHT:
          this.platform.log.info('set Remote Key Pressed: ARROW_RIGHT');
          controlCursor('right');
          break;

        case this.platform.Characteristic.RemoteKey.SELECT:
          this.platform.log.info('set Remote Key Pressed: SELECT');
          controlCursor('select');
          break;

        case this.platform.Characteristic.RemoteKey.BACK:
          this.platform.log.info('set Remote Key Pressed: BACK');
          controlCursor('return');
          break;

        case this.platform.Characteristic.RemoteKey.EXIT:
          this.platform.log.info('set Remote Key Pressed: EXIT');
          sendRemoteCode(MainZoneRemoteCode.TOP_MENU);
          break;

        case this.platform.Characteristic.RemoteKey.PLAY_PAUSE:
          this.platform.log.info('set Remote Key Pressed: PLAY_PAUSE');
          if (this.state.isPlaying) {
            sendRemoteCode(MainZoneRemoteCode.PAUSE);
          } else {
            sendRemoteCode(MainZoneRemoteCode.PLAY);
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
      const zoneStatusResponse = await fetch(`${this.baseApiUrl}/${this.zone}/getStatus`);
      const zoneStatus = (await zoneStatusResponse.json()) as ZoneStatus;

      if (zoneStatus.response_code !== 0) {
        throw new Error('Failed to set zone volume');
      }

      const currentVolume = zoneStatus.volume;
      const volumeStep = 5;

      let setVolumeResponse: Response;

      if (direction === 0) {
        this.platform.log.info('Volume Up', currentVolume + volumeStep);
        setVolumeResponse = await fetch(
          `${this.baseApiUrl}/${this.zone}/setVolume?power=${currentVolume + volumeStep}`,
        );
      } else {
        this.platform.log.info('Volume Down', currentVolume - volumeStep);
        setVolumeResponse = await fetch(
          `${this.baseApiUrl}/${this.zone}/setVolume?power=${currentVolume - volumeStep}`,
        );
      }

      const responseJson = (await setVolumeResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error('Failed to set zone volume');
      }
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }

  async getInputState(): Promise<CharacteristicValue> {
    const zoneStatus = await this.getZoneStatus();

    if (!zoneStatus) {
      return 0;
    }

    this.platform.log.info(`Current ${this.zone} input: ${zoneStatus.input}`);

    return this.state.inputs.findIndex((input) => input.id === zoneStatus.input);
  }

  async setInputState(inputIndex: CharacteristicValue) {
    try {
      if (typeof inputIndex !== 'number') {
        return;
      }

      const setInputResponse = await fetch(
        `${this.baseApiUrl}/${this.zone}/setInput?input=${this.state.inputs[inputIndex].id}`,
      );
      const responseJson = (await setInputResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error('Failed to set zone input');
      }

      this.platform.log.info(`Set input: ${this.state.inputs[inputIndex].id}`);
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }

  // Brightness as Volume?
  async getBrightness(): Promise<CharacteristicValue> {
    const zoneStatus = await this.getZoneStatus();

    if (!zoneStatus) {
      return 100;
    }

    return (zoneStatus.volume / zoneStatus.max_volume) * 50;
  }

  async setBrightness(state: CharacteristicValue) {
    try {
      const zoneStatus = await this.getZoneStatus();

      if (!zoneStatus) {
        return 50;
      }

      const setVolumeResponse = await fetch(
        `${this.baseApiUrl}/main/setVolume?volume=${((Number(state) * zoneStatus.max_volume) / 100).toFixed(0)}`,
      );

      const responseJson = (await setVolumeResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error(
          `Failed to set zone volume ${this.baseApiUrl}/main/setVolume?volume=${
            (Number(state) * zoneStatus.max_volume) / 100
          }`,
        );
      }
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }
}
