import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import fetch from 'node-fetch';

import { YamahaAVRPlatform } from './platform.js';
import { AccessoryContext, BaseResponse, Zone } from './types.js';
import { getZoneStatus } from './utils/getZoneStatus.js';

export class YamahaVolumeAccessory {
  private baseApiUrl: AccessoryContext['device']['baseApiUrl'];
  private service: Service;

  constructor(
    private readonly platform: YamahaAVRPlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
    private readonly zone: Zone['id'],
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

    this.service = this.accessory.addService(this.platform.Service.Fan);

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
    this.service.setCharacteristic(this.platform.Characteristic.On, true);

    // Mute Get/Set
    this.service
      .getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setMute.bind(this))
      .onGet(this.getMute.bind(this));

    // Volume Get/Set
    this.service
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onSet(this.setVolume.bind(this))
      .onGet(this.getVolume.bind(this));
  }

  async updateState() {
    const zoneStatus = await getZoneStatus(this.platform, this.accessory, this.zone);

    if (!zoneStatus) {
      return;
    }

    this.service.updateCharacteristic(this.platform.Characteristic.On, !zoneStatus.mute);
    this.service.updateCharacteristic(
      this.platform.Characteristic.RotationSpeed,
      (zoneStatus.volume / zoneStatus.max_volume) * 100,
    );
  }

  async getMute(): Promise<CharacteristicValue> {
    const zoneStatus = await getZoneStatus(this.platform, this.accessory, this.zone);

    if (!zoneStatus) {
      return false;
    }

    return !zoneStatus.mute;
  }

  async setMute(state: CharacteristicValue) {
    try {
      const setMuteResponse = await fetch(`${this.baseApiUrl}/${this.zone}/setMute?enable=${!state}`);

      const responseJson = (await setMuteResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error('Failed to set zone mute');
      }
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }

  async getVolume(): Promise<CharacteristicValue> {
    const zoneStatus = await getZoneStatus(this.platform, this.accessory, this.zone);

    if (!zoneStatus) {
      return 50;
    }

    return (zoneStatus.volume / zoneStatus.max_volume) * 100;
  }

  async setVolume(state: CharacteristicValue) {
    try {
      const zoneStatus = await getZoneStatus(this.platform, this.accessory, this.zone);

      if (!zoneStatus) {
        return;
      }

      const setVolumeResponse = await fetch(
        `${this.baseApiUrl}/${this.zone}/setVolume?volume=${((Number(state) * zoneStatus.max_volume) / 100).toFixed(
          0,
        )}`,
      );

      const responseJson = (await setVolumeResponse.json()) as BaseResponse;

      if (responseJson.response_code !== 0) {
        throw new Error(`Failed to set zone volume`);
      }
    } catch (error) {
      this.platform.log.error((error as Error).message);
    }
  }
}
