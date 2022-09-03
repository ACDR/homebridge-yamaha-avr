import {
  API,
  IndependentPlatformPlugin,
  Logger,
  PlatformConfig,
  Service,
  Characteristic,
  PlatformAccessory,
} from 'homebridge';
import fetch from 'node-fetch';

import { YamahaAVRAccessory } from './accessory.js';
import { PLUGIN_NAME } from './settings.js';
import { AccessoryContext, DeviceInfo, Features, Zone } from './types.js';

export class YamahaAVRPlatform implements IndependentPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];

  constructor(public readonly log: Logger, public readonly config: PlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // store restored cached accessories here
    this.accessories = [];

    this.api.on('didFinishLaunching', () => {
      this.discoverAVR();
    });
  }

  configureAccessory(accessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverAVR() {
    try {
      const baseApiUrl = `http://${this.config.ip}/YamahaExtendedControl/v1`;
      const deviceInfoResponse = await fetch(`${baseApiUrl}/system/getDeviceInfo`);
      const deviceInfo = (await deviceInfoResponse.json()) as DeviceInfo;

      const featuresResponse = await fetch(`${baseApiUrl}/system/getFeatures`);
      const features = (await featuresResponse.json()) as Features;

      if (deviceInfo.response_code !== 0) {
        throw new Error();
      }

      const device: AccessoryContext['device'] = {
        displayName: this.config.name ?? `Yamaha ${deviceInfo.model_name}`,
        modelName: deviceInfo.model_name,
        systemId: deviceInfo.system_id,
        firmwareVersion: deviceInfo.system_version,
        baseApiUrl,
      };

      const platformAccessories: PlatformAccessory[] = [];

      const mainAccessory = await this.createAVRAccessory(device, 'main');
      platformAccessories.push(mainAccessory);

      if (features.system.zone_num > 1) {
        const zone2Accessory = await this.createAVRAccessory(device, 'zone2');
        platformAccessories.push(zone2Accessory);
      }

      if (features.system.zone_num > 2) {
        const zone3Accessory = await this.createAVRAccessory(device, 'zone3');
        platformAccessories.push(zone3Accessory);
      }

      if (features.system.zone_num > 3) {
        const zone4Accessory = await this.createAVRAccessory(device, 'zone4');
        platformAccessories.push(zone4Accessory);
      }

      if (platformAccessories.length === 0) {
        return;
      }

      this.api.publishExternalAccessories(PLUGIN_NAME, platformAccessories);
    } catch {
      this.log.error(`
        Failed to get system config from ${this.config.name}. Please verify the AVR is connected and accessible at ${this.config.ip}
      `);
    }
  }

  async createAVRAccessory(device: AccessoryContext['device'], zone: Zone['id']): Promise<PlatformAccessory> {
    let uuid = `${device.systemId}_${this.config.ip}`;

    if (zone !== 'main') {
      uuid = `${uuid}_${zone}`;
    }

    uuid = this.api.hap.uuid.generate(uuid);

    const accessory = new this.api.platformAccessory<AccessoryContext>(
      `${device.displayName} ${zone}`,
      uuid,
      this.api.hap.Categories.AUDIO_RECEIVER,
    );

    accessory.context = { device };

    new YamahaAVRAccessory(this, accessory, zone);

    return accessory;
  }
}
