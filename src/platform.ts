import { API, IndependentPlatformPlugin, Logger, PlatformConfig, Service, Characteristic } from 'homebridge';
import Yamaha from 'yamaha-nodejs';

import { YamahaAPI } from './types';
import { PLUGIN_NAME } from './settings';
import { YamahaAVRAccessory } from './accessory';

export class YamahaAVRPlatform implements IndependentPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly YamahaAVR: YamahaAPI = new Yamaha(this.config.ip);

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.YamahaAVR.catchRequestErrors = false;
      this.discoverAVR();
    });
  }

  discoverAVR() {
    this.YamahaAVR.getSystemConfig()
      .then(
        systemConfig => {
          const config = {
            systemId: systemConfig.YAMAHA_AV.System[0].Config[0].System_ID[0],
            modelName: systemConfig.YAMAHA_AV.System[0].Config[0].Model_Name[0],
            firmwareVersion: systemConfig.YAMAHA_AV.System[0].Config[0].Version[0],
          };

          const features = systemConfig.YAMAHA_AV.System[0].Config[0].Feature_Existence[0];

          const device = {
            UUID: this.api.hap.uuid.generate(`${config.systemId}_2`),
            displayName: `Yamaha ${this.config.name}`,
          };

          const accessory = new this.api.platformAccessory(
            device.displayName,
            device.UUID,
            this.api.hap.Categories.AUDIO_RECEIVER,
          );

          accessory.context = {
            ...config,
            features,
            device,
          };

          new YamahaAVRAccessory(this, accessory);

          this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
        },
      )
      .catch(() => {
        this.log.error(`
          Failed to get system config from ${this.config.name}. Please verify the AVR is connected and accessible at ${this.config.ip}
        `);
      });
  }
}
