import { API, IndependentPlatformPlugin, Logger, PlatformConfig, Service, Characteristic } from 'homebridge';
import fetch from 'node-fetch';

import { YamahaAVRAccessory } from './accessory.js';
import { AccessoryContext, DeviceInfo } from './types.js';

export class YamahaAVRPlatform implements IndependentPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  constructor(public readonly log: Logger, public readonly config: PlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.discoverAVR();
    });
  }

  async discoverAVR() {
    try {
      const baseApiUrl = `http://${this.config.ip}/YamahaExtendedControl/v1`;
      const deviceInfoResponse = await fetch(`${baseApiUrl}/system/getDeviceInfo`);
      const deviceInfo = (await deviceInfoResponse.json()) as DeviceInfo;

      if (deviceInfo.response_code !== 0) {
        throw new Error();
      }

      const device: AccessoryContext['device'] = {
        uuid: this.api.hap.uuid.generate(`${deviceInfo.system_id}_${this.config.ip}_1`),
        displayName: this.config.name ?? `Yamaha ${deviceInfo.model_name}`,
        modelName: deviceInfo.model_name,
        systemId: deviceInfo.system_id,
        firmwareVersion: deviceInfo.system_version,
        baseApiUrl,
      };

      const accessory = new this.api.platformAccessory<AccessoryContext>(
        device.displayName,
        device.uuid,
        this.api.hap.Categories.AUDIO_RECEIVER,
      );

      accessory.context = { device };

      new YamahaAVRAccessory(this, accessory);
    } catch {
      this.log.error(`
        Failed to get system config from ${this.config.name}. Please verify the AVR is connected and accessible at ${this.config.ip}
      `);
    }
  }
}
