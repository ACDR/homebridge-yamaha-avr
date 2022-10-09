import {
  API,
  Characteristic,
  IndependentPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import Yamaha from 'yamaha-nodejs';

import { YamahaAVRAccessory } from './accessory.js';
import { YamahaPureDirectAccessory } from './pureDirectAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { AccessoryContext, YamahaAPI, Zone } from './types.js';

export class YamahaAVRPlatform implements IndependentPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly platformAccessories: PlatformAccessory[] = [];
  public readonly externalAccessories: PlatformAccessory[] = [];
  public readonly YamahaAVR: YamahaAPI = new Yamaha(this.config.ip);
  public readonly features: string[] = [];

  constructor(public readonly log: Logger, public readonly config: PlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      if (!this.config.ip) {
        this.log.error('IP address has not been set.');
        return;
      }

      this.YamahaAVR.catchRequestErrors = false;
      this.discoverAVR();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.platformAccessories.push(accessory);
  }

  async discoverAVR() {
    this.YamahaAVR.getSystemConfig()
      .then(async (systemConfig) => {
        const config = {
          systemId: systemConfig.YAMAHA_AV.System[0].Config[0].System_ID[0],
          modelName: systemConfig.YAMAHA_AV.System[0].Config[0].Model_Name[0],
          firmwareVersion: systemConfig.YAMAHA_AV.System[0].Config[0].Version[0],
        };

        const featuresXML = systemConfig.YAMAHA_AV.System[0].Config[0].Feature_Existence[0];

        for (const feature in featuresXML) {
          if (!feature.includes('Zone') && featuresXML[feature].includes('1')) {
            this.features.push(feature);
          }
        }

        const device = {
          ...config,
          displayName: this.config.name ?? `Yamaha ${config.modelName}`,
        };

        await this.createZoneAccessories(device, 'main');

        if (this.externalAccessories.length > 0) {
          this.api.publishExternalAccessories(PLUGIN_NAME, this.externalAccessories);
        }
      })
      .catch(() => {
        this.log.error(`
          Failed to get system config from ${this.config.name}. Please verify the AVR is connected and accessible at ${this.config.ip}
        `);
      });

    // try {
    //   const baseApiUrl = `http://${this.config.ip}/YamahaExtendedControl/v1`;
    //   const deviceInfoResponse = await fetch(`${baseApiUrl}/system/getDeviceInfo`);
    //   const deviceInfo = (await deviceInfoResponse.json()) as DeviceInfo;

    //   const featuresResponse = await fetch(`${baseApiUrl}/system/getFeatures`);
    //   const features = (await featuresResponse.json()) as Features;

    //   if (deviceInfo.response_code !== 0) {
    //     throw new Error();
    //   }

    //   const device: AccessoryContext['device'] = {
    //     displayName: this.config.name ?? `Yamaha ${deviceInfo.model_name}`,
    //     modelName: deviceInfo.model_name,
    //     systemId: deviceInfo.system_id,
    //     firmwareVersion: deviceInfo.system_version,
    //     baseApiUrl,
    //   };

    //   if (this.config.enablePureDirectSwitch) {
    //     await this.createPureDirectAccessory(device);
    //   }

    //   await this.createZoneAccessories(device, 'main');

    //   features.zone.length > 1 && (await this.createZoneAccessories(device, 'zone2'));
    //   features.zone.length > 2 && (await this.createZoneAccessories(device, 'zone3'));
    //   features.zone.length > 3 && (await this.createZoneAccessories(device, 'zone4'));

    //   if (this.externalAccessories.length > 0) {
    //     this.api.publishExternalAccessories(PLUGIN_NAME, this.externalAccessories);
    //   }
    // } catch {
    //   this.log.error(`
    //     Failed to get system config from ${this.config.name}. Please verify the AVR is connected and accessible at ${this.config.ip}
    //   `);
    // }
  }

  async createZoneAccessories(device, zone) {
    if (zone !== 'main' && !this.config[`${zone}Enabled`]) {
      return;
    }

    const avrAccessory = await this.createAVRAccessory(device, zone);
    this.externalAccessories.push(avrAccessory);
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

  async createPureDirectAccessory(device: AccessoryContext['device']): Promise<void> {
    const uuid = this.api.hap.uuid.generate(`${device.systemId}_${this.config.ip}_pureDirect`);

    const accessory = new this.api.platformAccessory<AccessoryContext>(
      'AVR Pure Direct',
      uuid,
      this.api.hap.Categories.SWITCH,
    );

    accessory.context = { device };

    new YamahaPureDirectAccessory(this, accessory);

    const existingAccessory = this.platformAccessories.find((accessory) => accessory.UUID === uuid);
    if (existingAccessory) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    }

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }
}
