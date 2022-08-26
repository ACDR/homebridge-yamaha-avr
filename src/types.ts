export interface YamahaAPI {
  getBasicInfo: () => Promise<{
    getVolume: () => number;
    getCurrentInput: () => string;
  }>;
  getSystemConfig: () => Promise<{
    YAMAHA_AV: {
      System: {
        Config: {
          Name: string[];
          Model_Name: string[];
          System_ID: string[];
          Version: string[];
          Feature_Existence: string[];
        }[];
      }[];
    };
  }>;
  getAvailableFeatures: () => Promise<string[]>;
  getAvailableInputsWithNames: () => Promise<
    {
      id: string;
      name: string;
    }[]
  >;
  isOn: () => Promise<boolean>;
  powerOn: () => Promise<string>;
  powerOff: () => Promise<string>;
  volumeUp: (number) => Promise<string>;
  volumeDown: (number) => Promise<string>;
  setInputTo: (string) => Promise<string>;
  rewind: () => Promise<string>;
  skip: () => Promise<string>;
  pause: () => Promise<string>;
  play: () => Promise<string>;
  catchRequestErrors: boolean;
}
