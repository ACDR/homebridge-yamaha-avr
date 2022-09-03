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
import { YamahaVolumeAccessory } from './volumeAccessory.js';
import { PLUGIN_NAME } from './settings.js';
import { AccessoryContext, DeviceInfo, Features, Zone } from './types.js';

export class YamahaAVRPlatform implements IndependentPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly platformAccessories: PlatformAccessory[] = [];

  constructor(public readonly log: Logger, public readonly config: PlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // store restored cached accessories here
    this.platformAccessories = [];

    this.api.on('didFinishLaunching', () => {
      this.discoverAVR();
    });
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

      await this.createZoneAccessories(device, 'main');

      this.config.zone2Enabled && features.zone.length > 1 && (await this.createZoneAccessories(device, 'zone2'));
      this.config.zone3Enabled && features.zone.length > 2 && (await this.createZoneAccessories(device, 'zone3'));
      this.config.zone4Enabled && features.zone.length > 3 && (await this.createZoneAccessories(device, 'zone4'));

      if (this.platformAccessories.length === 0) {
        return;
      }

      this.api.publishExternalAccessories(PLUGIN_NAME, this.platformAccessories);
    } catch {
      this.log.error(`
        Failed to get system config from ${this.config.name}. Please verify the AVR is connected and accessible at ${this.config.ip}
      `);
    }
  }

  async createZoneAccessories(device, zone) {
    const avrAccessory = await this.createAVRAccessory(device, zone);
    this.platformAccessories.push(avrAccessory);

    // const volumeAccessory = await this.createVolumeAccessory(device, zone);
    // this.platformAccessories.push(volumeAccessory);
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

  async createVolumeAccessory(device: AccessoryContext['device'], zone: Zone['id']): Promise<PlatformAccessory> {
    let uuid = `${device.systemId}_${this.config.ip}_volume`;

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

    new YamahaVolumeAccessory(this, accessory, zone);

    return accessory;
  }
}
