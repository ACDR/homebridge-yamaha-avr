import { PlatformAccessory } from 'homebridge';
import fetch from 'node-fetch';
import { YamahaAVRPlatform } from '../platform.js';
import { AccessoryContext, Zone, ZoneStatus } from '../types.js';

export const getZoneStatus = async (
  platform: YamahaAVRPlatform,
  accessory: PlatformAccessory<AccessoryContext>,
  zone: Zone['id'],
): Promise<ZoneStatus | void> => {
  const zoneStatusResponse = await fetch(`${accessory.context.device.baseApiUrl}/${zone}/getStatus`);
  const zoneStatus = (await zoneStatusResponse.json()) as ZoneStatus;

  if (zoneStatus.response_code !== 0) {
    platform.log.error('Failed to fetch zone status');
  }

  return zoneStatus;
};
