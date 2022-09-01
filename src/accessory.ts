import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
} from 'homebridge';
import fetch, { Response } from 'node-fetch';

import { PLUGIN_NAME } from './settings.js';
import { YamahaAVRPlatform } from './platform.js';
import { StorageService } from './storageService.js';
import { AccessoryContext, BaseResponse, Cursor, Input, MainZoneRemoteCode, NameText, ZoneStatus } from './types';

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
  ) {
    this.cacheDirectory = this.platform.config.cacheDirectory || this.platform.api.user.storagePath() + '/.yamahaAVR/';
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
    this.service.getCharacteristic(this.platform.Characteristic.RemoteKey).on('set', (remoteKey, callback) => {
      const sendRemoteCode = async (remoteKey: MainZoneRemoteCode, callback?: CharacteristicSetCallback) => {
        await fetch(`${this.baseApiUrl}/system/sendIrCode?code=${remoteKey}`);

        if (!callback) {
          return;
        }

        callback();
      };

      const controlCursor = async (cursor: Cursor, callback?: CharacteristicSetCallback) => {
        await fetch(`${this.baseApiUrl}/main/controlCursor?cursor=${cursor}`);

        if (!callback) {
          return;
        }

        callback();
      };

      switch (remoteKey) {
        case this.platform.Characteristic.RemoteKey.REWIND:
          this.platform.log.info('set Remote Key Pressed: REWIND');
          sendRemoteCode(MainZoneRemoteCode.SEARCH_BACK, callback);
          callback();
          break;

        case this.platform.Characteristic.RemoteKey.FAST_FORWARD:
          this.platform.log.info('set Remote Key Pressed: FAST_FORWARD');
          sendRemoteCode(MainZoneRemoteCode.SEARCH_FWD, callback);
          callback();
          break;

        case this.platform.Characteristic.RemoteKey.NEXT_TRACK:
          this.platform.log.info('set Remote Key Pressed: NEXT_TRACK');
          sendRemoteCode(MainZoneRemoteCode.SKIP_FWD, callback);
          break;

        case this.platform.Characteristic.RemoteKey.PREVIOUS_TRACK:
          this.platform.log.info('set Remote Key Pressed: PREVIOUS_TRACK');
          sendRemoteCode(MainZoneRemoteCode.SKIP_BACK, callback);
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_UP:
          this.platform.log.info('set Remote Key Pressed: ARROW_UP');
          controlCursor('up', callback);
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_DOWN:
          this.platform.log.info('set Remote Key Pressed: ARROW_DOWN');
          controlCursor('down', callback);
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_LEFT:
          this.platform.log.info('set Remote Key Pressed: ARROW_LEFT');
          controlCursor('left', callback);
          break;

        case this.platform.Characteristic.RemoteKey.ARROW_RIGHT:
          this.platform.log.info('set Remote Key Pressed: ARROW_RIGHT');
          controlCursor('right', callback);
          break;

        case this.platform.Characteristic.RemoteKey.SELECT:
          this.platform.log.info('set Remote Key Pressed: SELECT');
          controlCursor('select', callback);
          break;

        case this.platform.Characteristic.RemoteKey.BACK:
          this.platform.log.info('set Remote Key Pressed: BACK');
          controlCursor('return', callback);
          break;

        case this.platform.Characteristic.RemoteKey.EXIT:
          this.platform.log.info('set Remote Key Pressed: EXIT');
          sendRemoteCode(MainZoneRemoteCode.TOP_MENU, callback);
          break;

        case this.platform.Characteristic.RemoteKey.PLAY_PAUSE:
          this.platform.log.info('set Remote Key Pressed: PLAY_PAUSE');
          if (this.state.isPlaying) {
            sendRemoteCode(MainZoneRemoteCode.PAUSE);
          } else {
            sendRemoteCode(MainZoneRemoteCode.PLAY);
          }

          this.state.isPlaying = !this.state.isPlaying;

          callback();

          break;

        case this.platform.Characteristic.RemoteKey.INFORMATION:
          this.platform.log.info('set Remote Key Pressed: INFORMATION');
          // We'll use the info button to flick through inputs
          sendRemoteCode(MainZoneRemoteCode.INPUT_FWD, callback);
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
          inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName).on('set', (name, callback) => {
            this.platform.log.debug(`Set input (${input.id}) name to ${name}`);

            let configuredName = name;

            if (!name || input.text === name) {
              this.platform.log.debug(`Custom name not provided, clearing configured input name for`, input.text);

              configuredName = input.text;
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
                  inputService.getCharacteristic(this.platform.Characteristic.ConfiguredName).value || input.text,
                CurrentVisibilityState: targetVisibilityState,
              });

              callback(null);
            });

          inputService
            .getCharacteristic(this.platform.Characteristic.Name)
            .on('get', (callback) => callback(null, input.text));

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
      const getNameTextResponse = await fetch(`${this.baseApiUrl}/system/getNameText`);
      const nameText = (await getNameTextResponse.json()) as NameText;
      const inputList = nameText.input_list;
      this.state.inputs = inputList;
    } catch {
      this.platform.log.error(`
      Failed to get available inputs from ${this.platform.config.name}.
      Please verify the AVR is connected and accessible at ${this.platform.config.ip}
    `);
    }
  }

  async updateAVRState() {
    try {
      const zoneStatusResponse = await fetch(`${this.baseApiUrl}/main/getStatus`);
      const zoneStatus = (await zoneStatusResponse.json()) as ZoneStatus;

      this.service.updateCharacteristic(this.platform.Characteristic.Active, zoneStatus.power === 'on');
      this.service.updateCharacteristic(
        this.platform.Characteristic.ActiveIdentifier,
        this.state.inputs.findIndex((input) => input.id === zoneStatus.input),
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

  async getPowerState(callback: CharacteristicGetCallback) {
    try {
      const zoneStatusResponse = await fetch(`${this.baseApiUrl}/main/getStatus`);
      const zoneStatus = (await zoneStatusResponse.json()) as ZoneStatus;

      if (zoneStatus.response_code !== 0) {
        throw new Error('Failed to fetch zone power status');
      }

      callback(null, zoneStatus.power === 'on');
    } catch (error) {
      callback(error as Error, false);
    }
  }

  async setPowerState(state: CharacteristicValue, callback: CharacteristicSetCallback) {
    try {
      let setPowerResponse: Response;

      if (state) {
        this.platform.log.info('Power On');
        setPowerResponse = await fetch(`${this.baseApiUrl}/main/setPower?power=on`);
      } else {
        this.platform.log.info('Power Off');
        setPowerResponse = await fetch(`${this.baseApiUrl}/main/setPower?power=standby`);
      }

      const responseJson = (await setPowerResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error('Failed to set zone power');
      }

      callback(null);
    } catch (error) {
      callback(error as Error, false);
    }
  }

  async setVolume(direction: CharacteristicValue, callback: CharacteristicSetCallback) {
    try {
      const zoneStatusResponse = await fetch(`${this.baseApiUrl}/main/getStatus`);
      const zoneStatus = (await zoneStatusResponse.json()) as ZoneStatus;

      if (zoneStatus.response_code !== 0) {
        throw new Error('Failed to set zone volume');
      }

      const currentVolume = zoneStatus.volume;
      const volumeStep = 5;
      let setVolumeResponse: Response;

      if (direction === 0) {
        this.platform.log.info('Volume Up', currentVolume + volumeStep);
        setVolumeResponse = await fetch(`${this.baseApiUrl}/main/setVolume?power=${currentVolume + volumeStep}`);
      } else {
        this.platform.log.info('Volume Down', currentVolume - volumeStep);
        setVolumeResponse = await fetch(`${this.baseApiUrl}/main/setVolume?power=${currentVolume - volumeStep}`);
      }

      const responseJson = (await setVolumeResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error('Failed to set zone volume');
      }

      callback(null);
    } catch (error) {
      callback(error as Error, false);
    }
  }

  async getInputState(callback: CharacteristicGetCallback) {
    try {
      const zoneStatusResponse = await fetch(`${this.baseApiUrl}/main/getStatus`);
      const zoneStatus = (await zoneStatusResponse.json()) as ZoneStatus;

      if (zoneStatus.response_code !== 0) {
        throw new Error('Failed to fetch zone power status');
      }

      callback(
        null,
        this.state.inputs.findIndex((input) => input.id === zoneStatus.input),
      );
    } catch (error) {
      callback(error as Error, false);
    }
  }

  async setInputState(inputId: CharacteristicValue, callback: CharacteristicSetCallback) {
    try {
      const setInputResponse = await fetch(`${this.baseApiUrl}/main/setInput?input=${inputId}`);
      const responseJson = (await setInputResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error('Failed to set zone input');
      }

      callback(null);
    } catch (error) {
      callback(error as Error, false);
    }
  }
}
