import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import fetch from 'node-fetch';

import { YamahaAVRPlatform } from './platform.js';
import { AccessoryContext, BaseResponse } from './types.js';
import { getZoneStatus } from './utils/getZoneStatus.js';

export class YamahaPureDirectAccessory {
  private baseApiUrl: AccessoryContext['device']['baseApiUrl'];
  private service: Service;

  constructor(
    private readonly platform: YamahaAVRPlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
  ) {
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

    this.service = this.accessory.addService(this.platform.Service.Switch);

    this.baseApiUrl = this.accessory.context.device.baseApiUrl;
    this.init();

    // regularly ping the AVR to keep power/input state syncronised
    setInterval(this.updateState.bind(this), 5000);
  }

  async init() {
    try {
      await this.createService();
    } catch (err) {
      this.platform.log.error(err as string);
    }
  }

  async createService() {
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getState.bind(this))
      .onSet(this.setState.bind(this));
  }

  async updateState() {
    const zoneStatus = await getZoneStatus(this.platform, this.accessory, 'main');

    if (!zoneStatus) {
      return;
    }

    this.service.updateCharacteristic(
      this.platform.Characteristic.ProgrammableSwitchOutputState,
      zoneStatus.pure_direct,
    );
  }

  async getSwitchEvent(): Promise<CharacteristicValue> {
    return this.platform.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS;
  }

  async getState(): Promise<CharacteristicValue> {
    const zoneStatus = await getZoneStatus(this.platform, this.accessory, 'main');

    if (!zoneStatus) {
      return false;
    }

    return zoneStatus.pure_direct;
  }

  async setState(state: CharacteristicValue) {
    try {
      const setPureDirectResponse = await fetch(`${this.baseApiUrl}/${'main'}/setPureDirect?enable=${state}`);

      const responseJson = (await setPureDirectResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error('Failed to set pure direct');
      }
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }
}
