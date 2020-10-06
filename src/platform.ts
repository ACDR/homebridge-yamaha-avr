import { API, IndependentPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import Yamaha from 'yamaha-nodejs';

import { YamahaAPI } from './types';
import { PLUGIN_NAME } from './settings';
import { YamahaAVRAccessory } from './platformAccessory';

export class YamahaAVRPlatform implements IndependentPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly YamahaAVR: YamahaAPI = new Yamaha(this.config.ip);

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

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

  // This function is invoked when homebridge restores cached accessories from disk at startup.
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
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

          const device = {
            // generate a unique id for the accessory using the system id & model name
            UUID: this.api.hap.uuid.generate(
              `${config.systemId}_${config.modelName}_1`,
            ),
            displayName: `Yamaha ${this.config.name}`,
          };

          // see if an accessory with the same uuid has already been registered and restored from
          // the cached devices we stored in the `configureAccessory` method above
          const existingAccessory = this.accessories.find(accessory => accessory.UUID === device.UUID);

          if (existingAccessory) {
            this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
            new YamahaAVRAccessory(this, existingAccessory);
            return;
          }

          // the accessory does not yet exist, so we need to create it
          this.log.info('Adding new accessory:', device.displayName);

          const accessory = new this.api.platformAccessory(
            device.displayName,
            device.UUID,
            this.api.hap.Categories.AUDIO_RECEIVER,
          );

          accessory.context = {
            ...config,
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
